/**
 * Pins the web workspace sidebar's wiring: the Conversations badge counts
 * the active organization's conversations by its id, the way the server
 * names every org, and the count reaches the SDK sidebar as a prop. An org
 * switch lands on the org-neutral dashboard. The sidebar itself is pinned in
 * @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  countedOrg: [] as Array<string | null>,
  sidebar: [] as Array<Record<string, unknown>>,
  pushed: [] as string[],
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
    prependOptimistic: () => undefined,
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
    navigateToSession: () => undefined,
    navigateToHome: () => undefined,
  }),
}));

vi.mock("@/domain/workflow/run-navigation", () => ({
  useRunNavigation: () => ({
    activeRunId: null,
    isExecutionZone: false,
    navigateToRun: () => undefined,
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
});

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
