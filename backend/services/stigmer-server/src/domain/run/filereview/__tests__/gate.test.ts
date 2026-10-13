/**
 * Pins the HITL resume gate (../gate.ts): the turn may resume exactly when
 * none of its asks is open, and the gate a history recorded before the
 * open-gate count replays is the length of the pending approvals in the
 * run JSON its load recorded, read as written, never anything else of the
 * run (a change set awaiting review never holds a turn, stigmer#1471).
 */
import { describe, expect, it } from "vitest";

import { gateResolved, unresolvedGateCountOfJson } from "../gate.js";

describe("the HITL gate", () => {
  it("is resolved exactly when no ask is open", () => {
    expect(gateResolved(0)).toBe(true);
    expect(gateResolved(1)).toBe(false);
    expect(gateResolved(3)).toBe(false);
  });

  it("as a replayed history reads it, counts the recorded pending approvals, never change sets awaiting review", () => {
    expect(
      unresolvedGateCountOfJson({
        metadata: { id: "run_a" },
        status: {
          phase: "RUN_WAITING_FOR_APPROVAL",
          pendingApprovals: [{ toolCallId: "tc-1" }, { toolCallId: "tc-2" }],
          fileChangeSets: [{ id: "run_a:0", status: "FILE_CHANGE_SET_STATUS_AWAITING_REVIEW" }],
        },
      }),
    ).toBe(2);
    expect(
      unresolvedGateCountOfJson({
        status: { fileChangeSets: [{ id: "run_a:0", status: "FILE_CHANGE_SET_STATUS_AWAITING_REVIEW" }] },
      }),
    ).toBe(0);
  });

  it("reads the field under its proto name too", () => {
    expect(unresolvedGateCountOfJson({ status: { pending_approvals: [{ tool_call_id: "tc-1" }] } })).toBe(1);
  });

  it("counts nothing in a load that recorded no status or no object", () => {
    expect(unresolvedGateCountOfJson({ metadata: { id: "run_a" } })).toBe(0);
    expect(unresolvedGateCountOfJson(null)).toBe(0);
    expect(unresolvedGateCountOfJson([1, 2])).toBe(0);
    expect(unresolvedGateCountOfJson({ status: { pendingApprovals: "two" } })).toBe(0);
  });
});
