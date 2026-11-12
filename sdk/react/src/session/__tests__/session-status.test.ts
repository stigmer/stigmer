/**
 * Proves the words and hue of the session's status pill (../session-status.ts)
 * from its newest turn: Working (blue, timed) while the agent works; Waiting
 * for you (amber, timed) while a question or approval waits on the reader,
 * or Waiting for an answer for a reader who cannot answer it; Paused (amber,
 * timed); Starting (grey) before the turn has a phase that runs; Done
 * (green) once it completed; and once it ended otherwise, its ending's own
 * words and tone (`describeTurnEnding`), so the pill agrees with the notice
 * under the turn: grey for a person's stop ("Stopped by you" to the one who
 * answers the turn) and the platform's, amber at a spending cap or step
 * limit and when interrupted, red when it didn't finish; and no pill before
 * the session has a turn.
 */
import { describe, it, expect } from "vitest";
import type { Turn, TurnPhase } from "@stigmer/client";
import { samples } from "../../test";
import { sessionStatus } from "../session-status";

/** A turn from the person's message and the phases the run reported, in order. */
function turnThrough(phases: readonly TurnPhase[], stopCause = "", kind?: string): Turn {
  return samples.fold([
    samples.userMessageEvent("Fix the rounding"),
    ...phases.map((phase, i) =>
      samples.runStatusEvent(phase, {
        stopCause: i === phases.length - 1 ? stopCause : "",
        ...(i === phases.length - 1 && kind !== undefined ? { stopDetail: { kind } } : {}),
      }),
    ),
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

  it("says a person's stop in grey: theirs to the one who answers the turn, Stopped to anyone else", () => {
    expect(sessionStatus(turnThrough(["running", "cancelled"], "user"), true)).toEqual({ phase: "pending", label: "Stopped by you", timed: false });
    expect(sessionStatus(turnThrough(["running", "cancelled"], "user"), false)).toEqual({ phase: "pending", label: "Stopped", timed: false });
    expect(sessionStatus(turnThrough(["running", "cancelled"]), false)).toEqual({ phase: "pending", label: "Stopped", timed: false });
  });

  it("says the platform's stop in grey, though its run completed", () => {
    expect(sessionStatus(turnThrough(["running", "completed"], "platform_stop"), true)).toEqual({ phase: "pending", label: "Stopped by Stigmer", timed: false });
  });

  it("says a budget stop in amber, as the notice under the turn does", () => {
    expect(sessionStatus(turnThrough(["running", "terminated"], "budget_reached", "cost_cap"), true)).toEqual({
      phase: "degraded",
      label: "Paused at its spending cap",
      timed: false,
    });
    expect(sessionStatus(turnThrough(["running", "terminated"], "budget_reached", "tool_call_limit"), true)?.label).toBe("Paused at its step limit");
    expect(sessionStatus(turnThrough(["running", "failed"], "infrastructure", "runner_lost"), true)).toEqual({ phase: "degraded", label: "Interrupted", timed: false });
  });

  it("says Didn't finish, in red, for a failure", () => {
    expect(sessionStatus(turnThrough(["running", "failed"]), true)).toEqual({ phase: "failed", label: "Didn't finish", timed: false });
    expect(sessionStatus(turnThrough(["running", "failed"], "model_error", "provider_key_rejected"), true)).toEqual({
      phase: "failed",
      label: "Didn't finish",
      timed: false,
    });
  });
});
