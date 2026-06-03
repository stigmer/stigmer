import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// next/navigation's usePathname reflects only Next.js routing. We control it
// here to simulate real Next navigations independently of history.pushState.
let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import {
  AppNavigationProvider,
  useAppNavigation,
} from "../app-navigation";
import {
  SessionNavigationProvider,
  useSessionNavigation,
} from "@/domain/session/session-navigation";
import { useExecutionNavigation } from "@/domain/workflow/execution-navigation";

function setBrowserPath(path: string) {
  window.history.pushState(null, "", path);
}

beforeEach(() => {
  mockPathname = "/";
  setBrowserPath("/");
});

// ---------------------------------------------------------------------------
// app-navigation: the shared source of truth
// ---------------------------------------------------------------------------

describe("AppNavigationProvider", () => {
  it("seeds currentPath from the browser path on mount", () => {
    setBrowserPath("/executions/wex_seed");
    const { result } = renderHook(() => useAppNavigation(), {
      wrapper: AppNavigationProvider,
    });
    expect(result.current.currentPath).toBe("/executions/wex_seed");
  });

  it("navigate() updates currentPath and calls history.pushState (no reload)", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useAppNavigation(), {
      wrapper: AppNavigationProvider,
    });

    act(() => result.current.navigate("/executions/wex_1"));

    expect(result.current.currentPath).toBe("/executions/wex_1");
    expect(window.location.pathname).toBe("/executions/wex_1");
    expect(pushSpy).toHaveBeenCalledWith(null, "", "/executions/wex_1");
    pushSpy.mockRestore();
  });

  it("navigate() to the current path is a no-op (no duplicate history entry)", () => {
    const { result } = renderHook(() => useAppNavigation(), {
      wrapper: AppNavigationProvider,
    });
    const pushSpy = vi.spyOn(window.history, "pushState");

    act(() => result.current.navigate("/"));

    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("syncs currentPath on browser back/forward (popstate)", () => {
    const { result } = renderHook(() => useAppNavigation(), {
      wrapper: AppNavigationProvider,
    });

    act(() => {
      setBrowserPath("/sessions/s_back");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.currentPath).toBe("/sessions/s_back");
  });

  it("adopts a genuine Next.js navigation as the new source of truth", () => {
    const { result, rerender } = renderHook(() => useAppNavigation(), {
      wrapper: AppNavigationProvider,
    });
    expect(result.current.currentPath).toBe("/");

    act(() => {
      mockPathname = "/library";
      rerender();
    });

    expect(result.current.currentPath).toBe("/library");
  });
});

// ---------------------------------------------------------------------------
// Zone derivation across both consumers (single source of truth)
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AppNavigationProvider>
      <SessionNavigationProvider>{children}</SessionNavigationProvider>
    </AppNavigationProvider>
  );
}

function useZones() {
  const session = useSessionNavigation();
  const execution = useExecutionNavigation();
  return { session, execution };
}

describe("zone derivation", () => {
  it("treats home as the session zone with no active session", () => {
    const { result } = renderHook(useZones, { wrapper });
    expect(result.current.session.isSessionZone).toBe(true);
    expect(result.current.session.activeSessionId).toBeNull();
    expect(result.current.execution.isExecutionZone).toBe(false);
    expect(result.current.execution.activeExecutionId).toBeNull();
  });

  it("derives the active session id inside the session zone", () => {
    const { result } = renderHook(useZones, { wrapper });

    act(() => result.current.session.navigateToSession("s_42"));

    expect(result.current.session.isSessionZone).toBe(true);
    expect(result.current.session.activeSessionId).toBe("s_42");
    expect(result.current.execution.isExecutionZone).toBe(false);
  });

  it("derives the active execution id inside the execution zone", () => {
    const { result } = renderHook(useZones, { wrapper });

    act(() => result.current.execution.navigateToExecution("wex_42"));

    expect(result.current.execution.isExecutionZone).toBe(true);
    expect(result.current.execution.activeExecutionId).toBe("wex_42");
    expect(result.current.session.isSessionZone).toBe(false);
    expect(result.current.session.activeSessionId).toBeNull();
  });

  it("never reports two zones at once when crossing session -> execution", () => {
    const { result } = renderHook(useZones, { wrapper });

    act(() => result.current.session.navigateToSession("s_1"));
    expect(result.current.session.isSessionZone).toBe(true);
    expect(result.current.execution.isExecutionZone).toBe(false);

    act(() => result.current.execution.navigateToExecution("wex_1"));
    // The cross-zone bug a naive two-provider design would cause: both zones
    // true at once. A single source of truth makes them mutually exclusive.
    expect(result.current.execution.isExecutionZone).toBe(true);
    expect(result.current.session.isSessionZone).toBe(false);

    act(() => result.current.session.navigateToSession("s_2"));
    expect(result.current.session.isSessionZone).toBe(true);
    expect(result.current.session.activeSessionId).toBe("s_2");
    expect(result.current.execution.isExecutionZone).toBe(false);
  });

  it("captures the last session-zone path when leaving for a non-zone route", () => {
    const { result } = renderHook(useZones, { wrapper });

    act(() => result.current.session.navigateToSession("s_keep"));
    act(() => result.current.session.navigateToHome());
    // navigateToHome stays in the session zone, so nothing captured yet.
    expect(result.current.session.lastSessionZonePath).toBeNull();

    act(() => result.current.execution.navigateToExecution("wex_x"));
    // Left the session zone (home) for the execution zone.
    expect(result.current.session.lastSessionZonePath).toBe("/");
  });
});
