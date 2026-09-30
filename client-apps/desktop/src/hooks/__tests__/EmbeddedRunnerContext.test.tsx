// ---------------------------------------------------------------------------
// EmbeddedRunnerProvider — one runner for the whole app, kept in step with
// the host while it runs
//
// The provider shares one useEmbeddedRunner with every descendant and, while
// the runner is up, re-reads the host's state every five seconds, which is
// what lets a session whose worker stays alive for a background run show as
// running and clear once the run drains. It polls nothing while the runner
// is down, and nothing once unmounted.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { mockTauri } from "../../__test-utils__/tauri";
import { EmbeddedRunnerProvider, useRunner } from "../EmbeddedRunnerContext";

const SECOND = 1_000;

interface HostState {
  running: boolean;
  activeSessions: string[];
}

function runnerHost(state: HostState) {
  return mockTauri({
    runner_status: () => ({ ...state, activeWorkflowExecutions: [] }),
  });
}

function Sessions() {
  const { isRunning, activeSessions, refreshStatus } = useRunner();
  return (
    <div>
      <p>
        running={String(isRunning)} sessions=
        {activeSessions.join(",") || "none"}
      </p>
      <button onClick={() => void refreshStatus()}>refresh</button>
    </div>
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("EmbeddedRunnerProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls nothing while the runner is down", async () => {
    const tauri = runnerHost({ running: false, activeSessions: [] });
    render(
      <EmbeddedRunnerProvider>
        <Sessions />
      </EmbeddedRunnerProvider>,
    );

    await advance(60 * SECOND);
    expect(tauri.callsTo("runner_status")).toEqual([]);
  });

  it("re-reads the host every five seconds while the runner runs, and shows its truth", async () => {
    const state: HostState = { running: true, activeSessions: ["s1", "s2"] };
    const tauri = runnerHost(state);
    render(
      <EmbeddedRunnerProvider>
        <Sessions />
      </EmbeddedRunnerProvider>,
    );

    // A one-off refresh learns the runner is up; from then on the provider polls.
    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("running=true sessions=s1,s2")).toBeTruthy();
    const afterRefresh = tauri.callsTo("runner_status").length;

    state.activeSessions = ["s1"];
    await advance(5 * SECOND - 1);
    expect(tauri.callsTo("runner_status")).toHaveLength(afterRefresh);
    await advance(1);
    expect(tauri.callsTo("runner_status")).toHaveLength(afterRefresh + 1);
    expect(screen.getByText("running=true sessions=s1")).toBeTruthy();

    // The runner exits: the poll sees it, and polling stops.
    state.running = false;
    state.activeSessions = [];
    await advance(5 * SECOND);
    expect(screen.getByText("running=false sessions=none")).toBeTruthy();
    const whenStopped = tauri.callsTo("runner_status").length;
    await advance(30 * SECOND);
    expect(tauri.callsTo("runner_status")).toHaveLength(whenStopped);
  });

  it("stops polling once unmounted", async () => {
    const tauri = runnerHost({ running: true, activeSessions: [] });
    const { unmount } = render(
      <EmbeddedRunnerProvider>
        <Sessions />
      </EmbeddedRunnerProvider>,
    );
    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    const atUnmount = tauri.callsTo("runner_status").length;

    await advance(30 * SECOND);
    expect(tauri.callsTo("runner_status")).toHaveLength(atUnmount);
  });

  it("refuses a reader outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useRunner())).toThrow(
      "useRunner must be used within EmbeddedRunnerProvider",
    );
    spy.mockRestore();
  });
});
