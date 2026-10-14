/**
 * Pins the HITL resume gate (../gate.ts): the turn may resume exactly when
 * none of its asks is open, and the gate a history recorded before the
 * open-gate count replays is the length of the pending approvals in the
 * run JSON its load recorded, read as written, never anything else of the
 * run (a change set awaiting review never holds a turn, stigmer#1471). The
 * committed HITL history's own recorded load reads as the one pending
 * approval the original run waited on, so its replay waits for the signal
 * as the run did.
 */
import { readFileSync } from "node:fs";

import type { JsonValue } from "@bufbuild/protobuf";
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

  it("reads the load the committed HITL history recorded as the one approval its run waited on", () => {
    const history = JSON.parse(
      readFileSync(
        new URL("../../../../temporal/agentexecution/__tests__/replay-histories/hitl-approval.json", import.meta.url),
        "utf8",
      ),
    ) as {
      events: Array<{
        markerRecordedEventAttributes?: { details?: Record<string, { payloads?: Array<{ data?: string }> }> };
      }>;
    };
    const loads = history.events.flatMap((event) =>
      (event.markerRecordedEventAttributes?.details?.["result"]?.payloads ?? []).flatMap((payload) =>
        payload.data === undefined ? [] : [JSON.parse(Buffer.from(payload.data, "base64").toString("utf8")) as JsonValue],
      ),
    );
    expect(loads.map(unresolvedGateCountOfJson)).toEqual([1]);
  });
});
