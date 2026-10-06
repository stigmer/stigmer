/**
 * Pins the web workspace sidebar's wiring: the Conversations badge counts
 * the active organization's conversations by its id, the way the server
 * names every org, and the count reaches the SDK sidebar as a prop. An org
 * switch lands on the org-neutral dashboard. A plain click on a recents row
 * opens its session through session navigation, while a modifier-click is
 * left to the browser (a new tab). The sidebar itself is pinned in
 * @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RecentActivityEntry, RenderSidebarLink } from "@stigmer/react";

const page = vi.hoisted(() => ({
  countedOrg: [] as Array<string | null>,
  sidebar: [] as Array<Record<string, unknown>>,
  pushed: [] as string[],
  openedSessions: [] as string[],
}));

vi.mock("@stigmer/react", () => ({
  WorkspaceSidebar: (props: Record<string, unknown>) => {
    page.sidebar.push(props);
    return null;
  },
  useActiveOrgId: () => "org_acme",
  useConversationsWantsHumanCount: (org: string | null) => {
    page.countedOrg.push(org);
    return { count: 3 };
  },
  useRecentActivity: () => ({
    entries: [],
    refetch: () => undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
}));

vi.mock("@/domain/session/session-navigation", () => ({
  useSessionNavigation: () => ({
    activeSessionId: null,
    isSessionZone: false,
    navigateToSession: (id: string) => page.openedSessions.push(id),
    navigateToHome: () => undefined,
  }),
}));

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({
    isExecutionZone: false,
  }),
}));

vi.mock("../UserMenu", () => ({ UserMenu: () => null }));

vi.mock("../use-layout-state", () => ({
  useSidebarOpen: () => ({ isOpen: true, close: () => undefined }),
}));

import { Sidebar } from "../Sidebar";

beforeEach(() => {
  page.countedOrg.length = 0;
  page.sidebar.length = 0;
  page.pushed.length = 0;
  page.openedSessions.length = 0;
});

/** Renders the recents row the SDK sidebar would ask the shell for. */
function renderRow(id: string): HTMLElement {
  const renderLink = page.sidebar.at(-1)?.renderLink as RenderSidebarLink;
  const entry: RecentActivityEntry = { id, subject: id, updatedAt: new Date(0) };
  render(
    renderLink({
      id,
      href: `/sessions/${id}`,
      active: false,
      className: "row",
      "aria-current": undefined,
      children: id,
      entry,
    }),
  );
  return screen.getByText(id);
}

describe("web Sidebar", () => {
  it("counts the active org's conversations by its id and shows the count", () => {
    render(<Sidebar />);

    expect(page.countedOrg.at(-1)).toBe("org_acme");
    expect(page.sidebar.at(-1)).toMatchObject({
      conversationsBadgeCount: 3,
      activeNav: "dashboard",
    });
  });

  it("lands on the dashboard after an org switch", () => {
    render(<Sidebar />);

    act(() => (page.sidebar.at(-1)?.onOrgChanged as () => void)());

    expect(page.pushed).toEqual(["/dashboard"]);
  });
});

describe("web Sidebar — the recents list", () => {
  it("opens a recents row's session through session navigation", () => {
    render(<Sidebar />);

    fireEvent.click(renderRow("ses_row"));

    expect(page.openedSessions).toEqual(["ses_row"]);
  });

  it("leaves a modifier-click on a recents row to the browser", () => {
    render(<Sidebar />);

    fireEvent.click(renderRow("ses_tab"), { metaKey: true });

    expect(page.openedSessions).toEqual([]);
  });
});
