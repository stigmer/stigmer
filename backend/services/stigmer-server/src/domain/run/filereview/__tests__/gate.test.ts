/**
 * Pins the HITL resume gate (../gate.ts): it counts pending approvals
 * alone, so a change set awaiting review never holds a turn
 * (stigmer#1471), and the gate is resolved exactly when no approval is
 * pending.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { gateResolved, unresolvedGateCount } from "../gate.js";

describe("the HITL gate", () => {
  it("counts pending approvals, never change sets awaiting review", () => {
    const status = create(RunStatusSchema, {
      pendingApprovals: [{ toolCallId: "tc-1" }, { toolCallId: "tc-2" }],
      fileChangeSets: [
        { id: "run_a:0", status: FileChangeSetStatus.AWAITING_REVIEW },
      ],
    });
    expect(unresolvedGateCount(status)).toBe(2);
    expect(gateResolved(status)).toBe(false);
  });

  it("is resolved with no approval pending, whatever the change sets say", () => {
    const status = create(RunStatusSchema, {
      fileChangeSets: [
        { id: "run_a:0", status: FileChangeSetStatus.AWAITING_REVIEW },
        { id: "run_a:1", status: FileChangeSetStatus.DECIDED },
      ],
    });
    expect(unresolvedGateCount(status)).toBe(0);
    expect(gateResolved(status)).toBe(true);
  });
});
