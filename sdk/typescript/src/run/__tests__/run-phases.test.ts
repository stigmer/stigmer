// Proves the run-phase readers (../run-phases.ts): the four phases that end a
// run are terminal and no other is; every phase a run reports has its turn
// phase in the session log's words, so `exitCodeOf` reads a Run's outcome
// from the one table (completed 0; failed, cancelled, terminated 1; a turn
// still working 130), and an unspecified phase has none.
import { describe, expect, it } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { exitCodeOf } from "../../exit-codes";
import { isTerminalPhase, turnPhaseOf } from "../run-phases";

describe("isTerminalPhase", () => {
  it("holds the four phases that end a run, and no other", () => {
    const terminal = Object.values(RunPhase)
      .filter((phase): phase is RunPhase => typeof phase === "number")
      .filter(isTerminalPhase);
    expect(terminal.sort()).toEqual([RunPhase.RUN_COMPLETED, RunPhase.RUN_FAILED, RunPhase.RUN_CANCELLED, RunPhase.RUN_TERMINATED].sort());
  });
});

describe("turnPhaseOf", () => {
  it.each([
    [RunPhase.RUN_PENDING, "pending", 130],
    [RunPhase.RUN_IN_PROGRESS, "running", 130],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, "waiting", 130],
    [RunPhase.RUN_PAUSED, "paused", 130],
    [RunPhase.RUN_COMPLETED, "completed", 0],
    [RunPhase.RUN_FAILED, "failed", 1],
    [RunPhase.RUN_CANCELLED, "cancelled", 1],
    [RunPhase.RUN_TERMINATED, "terminated", 1],
  ])("names run phase %i as %s, which exits %i", (phase, turnPhase, code) => {
    expect(turnPhaseOf(phase)).toBe(turnPhase);
    expect(exitCodeOf({ phase: turnPhaseOf(phase)! })).toBe(code);
  });

  it("names no turn phase for an unspecified run phase", () => {
    expect(turnPhaseOf(RunPhase.RUN_PHASE_UNSPECIFIED)).toBeUndefined();
  });
});
