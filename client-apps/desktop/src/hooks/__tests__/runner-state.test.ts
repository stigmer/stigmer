// ---------------------------------------------------------------------------
// The runner's state and its words
//
// runnerStateOf folds the runner hook's facts into the one state the
// sidebar's row shows; runnerStatusLine says each state in the person's
// words, with the act it offers. Both are pure: every state and every
// precedence between facts is pinned here, without a runner.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { runnerStateOf, runnerStatusLine, type RunnerFacts } from "../runner-state";

const FACTS: RunnerFacts = {
  isRunning: false,
  isStarting: false,
  stoppedUnexpectedly: false,
  error: null,
  activeSessions: [],
};

describe("DSK-05 runnerStateOf", () => {
  it("is idle before anything ran", () => {
    expect(runnerStateOf(FACTS)).toEqual({ kind: "idle" });
  });

  it("is ready with the number of conversations the runner holds", () => {
    expect(runnerStateOf({ ...FACTS, isRunning: true })).toEqual({ kind: "ready", conversations: 0 });
    expect(runnerStateOf({ ...FACTS, isRunning: true, activeSessions: ["a", "b"] })).toEqual({
      kind: "ready",
      conversations: 2,
    });
  });

  it("is stopped when a runner that was up is gone", () => {
    expect(runnerStateOf({ ...FACTS, stoppedUnexpectedly: true })).toEqual({ kind: "stopped" });
  });

  it("is failed with the host's reason", () => {
    expect(runnerStateOf({ ...FACTS, error: "spawn failed" })).toEqual({ kind: "failed", reason: "spawn failed" });
  });

  it("shows a start in progress over everything, so Restart answers at once", () => {
    expect(
      runnerStateOf({ ...FACTS, isStarting: true, isRunning: true, stoppedUnexpectedly: true, error: "x" }),
    ).toEqual({ kind: "starting" });
  });

  it("puts a running runner over an older failure or stop", () => {
    expect(runnerStateOf({ ...FACTS, isRunning: true, error: "x", stoppedUnexpectedly: true }).kind).toBe("ready");
  });

  it("puts a failed start over an older stop", () => {
    expect(runnerStateOf({ ...FACTS, error: "x", stoppedUnexpectedly: true }).kind).toBe("failed");
  });
});

describe("DSK-05 runnerStatusLine", () => {
  it("says before anything ran that agents start with a conversation, and offers nothing", () => {
    expect(runnerStatusLine({ kind: "idle" })).toEqual({
      label: "Agents start with a conversation",
      tone: "quiet",
    });
  });

  it("says agents are starting", () => {
    expect(runnerStatusLine({ kind: "starting" })).toEqual({ label: "Starting agents…", tone: "quiet" });
  });

  it("says agents are ready, or how many conversations they work on", () => {
    expect(runnerStatusLine({ kind: "ready", conversations: 0 })).toEqual({ label: "Agents ready", tone: "live" });
    expect(runnerStatusLine({ kind: "ready", conversations: 1 }).label).toBe("Agents working on 1 conversation");
    expect(runnerStatusLine({ kind: "ready", conversations: 3 }).label).toBe("Agents working on 3 conversations");
  });

  it("says agents stopped and offers Restart", () => {
    expect(runnerStatusLine({ kind: "stopped" })).toEqual({ label: "Agents stopped", tone: "alert", action: "Restart" });
  });

  it("says agents couldn't start, with the reason, and offers Try again", () => {
    expect(runnerStatusLine({ kind: "failed", reason: "spawn failed" })).toEqual({
      label: "Agents couldn't start",
      detail: "spawn failed",
      tone: "alert",
      action: "Try again",
    });
  });
});
