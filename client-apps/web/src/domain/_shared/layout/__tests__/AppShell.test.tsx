/**
 * Pins the web app shell's run zone: a /runs/<id> path renders that run in
 * place of the page, without a page load. A workflow run shows its run
 * viewer, keyed on the id; an agent run (`aex_*`) shows nothing of its own and
 * hands off to its session once the session it ran in is resolved. Off the
 * run zone, the page's own content renders. The viewers, the sidebars and the
 * session zone are stubbed; their wiring is pinned in their own suites.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const shell = vi.hoisted(() => ({
  path: "/",
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
  openedSessions: [] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => shell.path,
}));

vi.mock("@/domain/_shared/navigation/app-navigation", () => ({
  useAppNavigation: () => ({ currentPath: shell.path, navigate: () => undefined }),
}));

vi.mock("@/domain/session/session-navigation", () => ({
  useSessionNavigation: () => ({
    activeSessionId: null,
    isSessionZone: false,
    navigateToSession: (id: string) => shell.openedSessions.push(id),
  }),
}));

vi.mock("@stigmer/react", () => ({
  useResolveAgentRunSession: (id: string | null) => {
    shell.resolving.push(id);
    return { sessionId: id ? shell.sessionFor.get(id) : undefined };
  },
}));

vi.mock("@/domain/workflow/WorkflowRunDetailPage", () => ({
  WorkflowRunDetailPage: ({ executionId }: { executionId: string }) => (
    <p>workflow run {executionId}</p>
  ),
}));
vi.mock("@/domain/session/SessionLauncher", () => ({ SessionLauncher: () => null }));
vi.mock("@/domain/session/SessionPage", () => ({ SessionPageInner: () => null }));
vi.mock("../Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../ManagementSidebar", () => ({ ManagementSidebar: () => null }));
vi.mock("../DesktopAppBanner", () => ({
  DesktopAppBanner: () => null,
  useDesktopBannerState: () => ({ visible: false, dismiss: () => undefined }),
}));
vi.mock("../use-layout-state", () => ({
  LG_BREAKPOINT: 1024,
  useSidebarOpen: () => ({ isOpen: true, open: () => undefined, close: () => undefined }),
}));

import { AppShell } from "../AppShell";

function renderShell(path: string, children: ReactNode = <p>page content</p>) {
  shell.path = path;
  return render(<AppShell>{children}</AppShell>);
}

beforeEach(() => {
  shell.resolving.length = 0;
  shell.sessionFor.clear();
  shell.openedSessions.length = 0;
});

describe("web AppShell — the run zone", () => {
  it("renders a workflow run's viewer in place of the page", () => {
    renderShell("/runs/wfr_1");

    expect(screen.getByText("workflow run wfr_1")).toBeTruthy();
    expect(screen.queryByText("page content")).toBeNull();
    expect(shell.resolving.at(-1)).toBeNull();
  });

  it("hands an agent run off to the session it ran in, showing nothing of its own", () => {
    shell.sessionFor.set("aex_1", "ses_1");
    renderShell("/runs/aex_1");

    expect(shell.resolving.at(-1)).toBe("aex_1");
    expect(shell.openedSessions).toEqual(["ses_1"]);
    expect(screen.queryByText(/workflow run/)).toBeNull();
    expect(screen.queryByText("page content")).toBeNull();
  });

  it("waits on an agent run whose session is not resolved yet", () => {
    renderShell("/runs/aex_2");

    expect(shell.openedSessions).toEqual([]);
    expect(screen.queryByText(/workflow run/)).toBeNull();
  });

  it("renders the page's own content off the run zone", () => {
    renderShell("/dashboard");

    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.queryByText(/workflow run/)).toBeNull();
  });
});
