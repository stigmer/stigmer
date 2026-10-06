/**
 * Pins the web app shell's run zone: a /runs/<id> path shows nothing of its
 * own and hands the run off to the session it ran in, once that session is
 * resolved, without a page load. A run that resolves to no session says the
 * run was not found. Off the run zone, the page's own content renders. The
 * run-not-found state, the sidebars and the session zone are stubbed; their
 * wiring is pinned in their own suites.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const shell = vi.hoisted(() => ({
  path: "/",
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
  pending: new Set<string>(),
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
    return {
      sessionId: id ? (shell.sessionFor.get(id) ?? null) : null,
      isLoading: id !== null && shell.pending.has(id),
    };
  },
}));

vi.mock("@/domain/runs/RunNotFound", () => ({ RunNotFound: () => <p>not found</p> }));
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
  shell.pending.clear();
  shell.openedSessions.length = 0;
});

describe("web AppShell — the run zone", () => {
  it("hands a run off to the session it ran in, showing nothing of its own", () => {
    shell.sessionFor.set("aex_1", "ses_1");
    renderShell("/runs/aex_1");

    expect(shell.resolving.at(-1)).toBe("aex_1");
    expect(shell.openedSessions).toEqual(["ses_1"]);
    expect(screen.queryByText("not found")).toBeNull();
    expect(screen.queryByText("page content")).toBeNull();
  });

  it("waits on a run whose session is not resolved yet", () => {
    shell.pending.add("aex_2");
    renderShell("/runs/aex_2");

    expect(shell.openedSessions).toEqual([]);
    expect(screen.queryByText("not found")).toBeNull();
    expect(screen.queryByText("page content")).toBeNull();
  });

  it("says the run was not found when no run resolves", () => {
    renderShell("/runs/aex_missing");

    expect(shell.resolving.at(-1)).toBe("aex_missing");
    expect(shell.openedSessions).toEqual([]);
    expect(screen.getByText("not found")).toBeTruthy();
    expect(screen.queryByText("page content")).toBeNull();
  });

  it("renders the page's own content off the run zone", () => {
    renderShell("/dashboard");

    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.queryByText("not found")).toBeNull();
    expect(shell.resolving).toEqual([]);
  });
});
