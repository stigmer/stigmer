/**
 * Pins a run's pending approvals (../pending.ts): the row scan's waiting
 * calls, kept to those whose tool use is still open in the session's log,
 * at the root and in a running sub-agent alike; a waiting row with no open
 * ask is not pending and is logged; a terminal run has none.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, SubAgentStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import { pendingApprovalsOf } from "../pending.js";

function status(phase: RunPhase) {
  const waiting = (id: string) => ({
    id,
    name: "write",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: true,
  });
  return create(RunStatusSchema, {
    phase,
    messages: [{ toolCalls: [waiting("tc-a"), waiting("tc-b")] }],
    subAgentRuns: [
      { id: "task-1", name: "explorer", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS, messages: [{ toolCalls: [waiting("tc-s")] }] },
    ],
  });
}

describe("pendingApprovalsOf", () => {
  it("keeps the waiting calls whose asks are open, at the root and in a sub-agent", () => {
    const pending = pendingApprovalsOf(
      "run_1",
      status(RunPhase.RUN_WAITING_FOR_APPROVAL),
      new Set(["run_1.tc-b", "run_1.tc-s"]),
    );
    expect(pending.map((p) => [p.toolCallId, p.fromSubAgent, p.subAgentName])).toEqual([
      ["tc-b", false, ""],
      ["tc-s", true, "explorer"],
    ]);
  });

  it("logs the waiting rows whose ask is not open", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", pretty: false, write: (line) => void lines.push(line) });
    expect(pendingApprovalsOf("run_1", status(RunPhase.RUN_WAITING_FOR_APPROVAL), new Set(), logger)).toEqual([]);
    expect(lines.join("")).toContain("hitl_waiting_row_without_ask");
  });

  it("a terminal run has nothing pending, whatever is open", () => {
    expect(pendingApprovalsOf("run_1", status(RunPhase.RUN_CANCELLED), new Set(["run_1.tc-a"]))).toEqual([]);
  });
});
