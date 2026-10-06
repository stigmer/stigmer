/**
 * The run JSON that crosses Temporal is decoded from what an older server
 * or runner wrote: a local activity's result is replayed from history, and
 * an activity's input or a runner's result was recorded before the deploy.
 * Pins that:
 *
 * - names retired by the rename of executions to runs (field JSON names,
 *   enum value names, the kind string) read as their current names, fed
 *   the JSON the replay histories record, while a free-form string that
 *   happens to spell a retired name is left as written;
 * - the workflow's load still drops a reserved enum name or an unknown
 *   field, keeping everything else;
 * - the runner result's phase lookup reads a retired phase name.
 */
import { describe, expect, it } from "vitest";
import {
  ApprovalPolicySource,
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import { decodeLoadedExecution } from "../execution-json.js";
import { getPhaseFromResult } from "../runner-result.js";

describe("decodeLoadedExecution", () => {
  it("reads the load result a replay history records, written before the run rename", () => {
    // hitl-approval.json's LoadAgentExecution marker result, with the kind
    // string and two renamed fields an older server also wrote.
    const execution = decodeLoadedExecution({
      kind: "AgentExecution",
      metadata: { id: "exec-replay" },
      spec: { supersedesExecutionId: "aex_prev" },
      status: {
        phase: "EXECUTION_WAITING_FOR_APPROVAL",
        pendingApprovals: [{ toolCallId: "tc-1", toolName: "echo" }],
        subAgentExecutions: [{ id: "sub_1", name: "researcher" }],
        messages: [{ content: "EXECUTION_COMPLETED is a phase name" }],
      },
    });
    expect(execution.kind).toBe("AgentRun");
    expect(execution.metadata?.id).toBe("exec-replay");
    expect(execution.spec?.supersedesRunId).toBe("aex_prev");
    expect(execution.status?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(execution.status?.pendingApprovals[0]?.toolCallId).toBe("tc-1");
    expect(execution.status?.subAgentRuns[0]?.name).toBe("researcher");
    expect(execution.status?.messages[0]?.content).toBe("EXECUTION_COMPLETED is a phase name");
  });

  it("decodes a tool call carrying a reserved provenance name as UNSPECIFIED, keeping the rest", () => {
    const execution = decodeLoadedExecution({
      metadata: { id: "aex_1" },
      status: {
        messages: [
          {
            toolCalls: [
              {
                id: "call_1",
                name: "search_issues",
                status: "TOOL_CALL_COMPLETED",
                approvalPolicySource: "APPROVAL_POLICY_SOURCE_CLASSIFIER_DEFAULT",
              },
            ],
          },
        ],
      },
    });
    const call = execution.status?.messages[0]?.toolCalls[0];
    expect(execution.metadata?.id).toBe("aex_1");
    expect(call?.name).toBe("search_issues");
    expect(call?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(call?.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
  });

  it("drops a field the contract no longer knows", () => {
    const execution = decodeLoadedExecution({ metadata: { id: "aex_2" }, removedField: true });
    expect(execution.metadata?.id).toBe("aex_2");
  });
});

describe("getPhaseFromResult", () => {
  it("reads the phase a runner result recorded before the run rename", () => {
    // The ExecuteAgent result hitl-approval.json records.
    expect(getPhaseFromResult({ phase: "EXECUTION_WAITING_FOR_APPROVAL" })).toBe(
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    );
    expect(getPhaseFromResult({ phase: "RUN_COMPLETED" })).toBe(RunPhase.RUN_COMPLETED);
    expect(getPhaseFromResult({ phase: "EXECUTION_EXPLODED" })).toBe(
      RunPhase.RUN_PHASE_UNSPECIFIED,
    );
  });
});
