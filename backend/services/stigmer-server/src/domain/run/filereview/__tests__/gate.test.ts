/**
 * Pins the HITL resume gate (../gate.ts): the turn may resume exactly when
 * none of its asks is open, and the gate a replayed history reads counts
 * pending approvals alone, so a change set awaiting review never holds a
 * turn (stigmer#1471).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { gateResolved, unresolvedGateCount } from "../gate.js";

describe("the HITL gate", () => {
  it("is resolved exactly when no ask is open", () => {
    expect(gateResolved(0)).toBe(true);
    expect(gateResolved(1)).toBe(false);
    expect(gateResolved(3)).toBe(false);
  });

  it("as a replayed history reads it, counts pending approvals, never change sets awaiting review", () => {
    const status = create(RunStatusSchema, {
      pendingApprovals: [{ toolCallId: "tc-1" }, { toolCallId: "tc-2" }],
      fileChangeSets: [
        { id: "run_a:0", status: FileChangeSetStatus.AWAITING_REVIEW },
      ],
    });
    expect(unresolvedGateCount(status)).toBe(2);
    expect(
      unresolvedGateCount(
        create(RunStatusSchema, {
          fileChangeSets: [
            { id: "run_a:0", status: FileChangeSetStatus.AWAITING_REVIEW },
            { id: "run_a:1", status: FileChangeSetStatus.DECIDED },
          ],
        }),
      ),
    ).toBe(0);
  });
});
