/**
 * Pins the web workspace sidebar's wiring: the Conversations badge counts
 * the active organization's conversations by its id, the way the server
 * names every org, and the count reaches the SDK sidebar as a prop. An org
 * switch lands on the org-neutral dashboard. Viewing a run the recents list
 * does not hold yet puts a loading placeholder for it at the top, and a plain
 * click on a recents row opens a session or a run through its navigation
 * provider, while a modifier-click is left to the browser (a new tab). The
 * sidebar itself is pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RecentActivityEntry, RenderSidebarLink } from "@stigmer/react";

const page = vi.hoisted(() => ({
  countedOrg: [] as Array<string | null>,
  sidebar: [] as Array<Record<string, unknown>>,
  pushed: [] as string[],
  activeRunId: null as string | null,
  entries: [] as Array<Pick<RecentActivityEntry, "id" | "type">>,
  optimistic: [] as Array<Record<string, unknown>>,
  openedSessions: [] as string[],
  openedRuns: [] as string[],
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
    entries: page.entries,
    refetch: () => undefined,
    prependOptimistic: (entry: Record<string, unknown>) => page.optimistic.push(entry),
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

vi.mock("@/domain/workflow/run-navigation", () => ({
  useRunNavigation: () => ({
    activeRunId: page.activeRunId,
    isExecutionZone: page.activeRunId !== null,
    navigateToRun: (id: string) => page.openedRuns.push(id),
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
  page.activeRunId = null;
  page.entries = [];
  page.optimistic.length = 0;
  page.openedSessions.length = 0;
  page.openedRuns.length = 0;
});

/** Renders the recents row the SDK sidebar would ask the shell for. */
function renderRow({ id, type }: Pick<RecentActivityEntry, "id" | "type">): HTMLElement {
  const renderLink = page.sidebar.at(-1)?.renderLink as RenderSidebarLink;
  const entry: RecentActivityEntry = { id, type, subject: id, updatedAt: new Date(0) };
  render(
    renderLink({
      id,
      href: `/${type === "session" ? "sessions" : "runs"}/${id}`,
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

describe("web Sidebar — runs in the recents list", () => {
  it("lists a viewed run the recents list does not hold yet as a loading workflow run", () => {
    page.activeRunId = "wfr_new";
    render(<Sidebar />);

    expect(page.optimistic).toEqual([
      { id: "wfr_new", type: "workflow_run", subject: "Loading\u2026" },
    ]);
  });

  it("adds no placeholder for a run the recents list already holds", () => {
    page.activeRunId = "wfr_known";
    page.entries = [{ id: "wfr_known", type: "workflow_run" }];
    render(<Sidebar />);

    expect(page.optimistic).toEqual([]);
  });

  it("opens a run row through run navigation and a session row through session navigation", () => {
    render(<Sidebar />);

    fireEvent.click(renderRow({ id: "wfr_row", type: "workflow_run" }));
    fireEvent.click(renderRow({ id: "ses_row", type: "session" }));

    expect(page.openedRuns).toEqual(["wfr_row"]);
    expect(page.openedSessions).toEqual(["ses_row"]);
  });

  it("leaves a modifier-click on a run row to the browser", () => {
    render(<Sidebar />);

    fireEvent.click(renderRow({ id: "wfr_tab", type: "workflow_run" }), { metaKey: true });

    expect(page.openedRuns).toEqual([]);
  });
});
