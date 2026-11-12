/**
 * Proves the words and hue of the session's status pill (../session-status.ts)
 * from its newest turn: Working (blue, timed) while the agent works; Waiting
 * for you (amber, timed) while a question or approval waits on the reader,
 * or Waiting for an answer for a reader who cannot answer it; Paused (amber,
 * timed); Starting (grey) before the turn has a phase that runs; Done
 * (green) once it completed; Stopped (grey) when a person stopped it or a
 * cancel names no cause; Didn't finish (red) for every other ending; and no
 * pill before the session has a turn.
 */
import { describe, it, expect } from "vitest";
import type { Turn, TurnPhase } from "@stigmer/client";
import { samples } from "../../test";
import { sessionStatus } from "../session-status";

/** A turn from the person's message and the phases the run reported, in order. */
function turnThrough(phases: readonly TurnPhase[], stopCause = ""): Turn {
  return samples.fold([
    samples.userMessageEvent("Fix the rounding"),
    ...phases.map((phase, i) => samples.runStatusEvent(phase, { stopCause: i === phases.length - 1 ? stopCause : "" })),
  ]).turns[0]!;
}

/** A running turn whose tool call waits on a person's approval. */
function askingTurn(): Turn {
  const id = "run_1.tc-write_file";
  return samples.fold([
    samples.userMessageEvent("Fix the rounding"),
    samples.runStatusEvent("running"),
    samples.toolUseEvent("write_file", { path: "src/billing/rounding.ts" }, { id, evaluatedPermission: "ask" }),
    samples.permissionAskedEvent(id),
  ]).turns[0]!;
}

describe("sessionStatus", () => {
  it("has no pill before the session has a turn", () => {
    expect(sessionStatus(undefined, true)).toBeUndefined();
  });

  it("says Working, in blue with its time, while the agent works", () => {
    expect(sessionStatus(turnThrough(["running"]), true)).toEqual({ phase: "running", label: "Working", timed: true });
  });

  it("says the turn waits for the reader, in amber with its time, while an ask waits", () => {
    const turn = askingTurn();
    expect(turn.asks.length).toBeGreaterThan(0);
    expect(turn.status?.phase).toBe("running");
    expect(sessionStatus(turn, true)).toEqual({ phase: "degraded", label: "Waiting for you", timed: true });
  });

  it("says the turn waits once the run reports waiting, even before its ask is folded", () => {
    expect(sessionStatus(turnThrough(["running", "waiting"]), true)).toEqual({ phase: "degraded", label: "Waiting for you", timed: true });
  });

  it("tells a reader who cannot answer that the turn waits for an answer", () => {
    expect(sessionStatus(askingTurn(), false)).toEqual({ phase: "degraded", label: "Waiting for an answer", timed: true });
    expect(sessionStatus(turnThrough(["running", "waiting"]), false)?.label).toBe("Waiting for an answer");
  });

  it("says Paused, in amber with its time", () => {
    expect(sessionStatus(turnThrough(["running", "paused"]), true)).toEqual({ phase: "degraded", label: "Paused", timed: true });
  });

  it("says Starting, in grey without a time, before the turn runs", () => {
    expect(sessionStatus(turnThrough([]), true)).toEqual({ phase: "pending", label: "Starting", timed: false });
    expect(sessionStatus(turnThrough(["pending"]), true)).toEqual({ phase: "pending", label: "Starting", timed: false });
  });

  it("says Done, in green, once the turn completed", () => {
    expect(sessionStatus(turnThrough(["running", "completed"]), true)).toEqual({ phase: "ready", label: "Done", timed: false });
  });

  it("says Stopped, in grey, when a person stopped the turn or a cancel names no cause", () => {
    expect(sessionStatus(turnThrough(["running", "cancelled"], "user"), true)).toEqual({ phase: "pending", label: "Stopped", timed: false });
    expect(sessionStatus(turnThrough(["running", "cancelled"]), true)).toEqual({ phase: "pending", label: "Stopped", timed: false });
  });

  it("says Didn't finish, in red, for a failure and for a cancel with another cause", () => {
    expect(sessionStatus(turnThrough(["running", "failed"]), true)).toEqual({ phase: "failed", label: "Didn't finish", timed: false });
    expect(sessionStatus(turnThrough(["running", "cancelled"], "budget_reached"), true)).toEqual({
      phase: "failed",
      label: "Didn't finish",
      timed: false,
    });
  });
});
