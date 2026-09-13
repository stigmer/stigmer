/**
 * `harness/approval-decisions.ts` — the runtime's one settler of a decision
 * that never runs the tool. These arms came with the function from the
 * native harness's `hitl.ts` (`reconcileNonExecutingDecisions`, S3 M1 /
 * M2a): SKIP and REJECT settle to SKIPPED (REJECT with the pinned reason),
 * APPROVE and APPROVE_ALL are left to the engine's own events, sub-agent
 * transcripts are settled alike, and an undecided row is untouched. The
 * reader half (`approvalDecisionsOf`) is pinned against the Cursor adapter's
 * own reader in `execute-cursor/__tests__/approval-decisions-agree.test.ts`
 * and exercised through `turn-context.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { REJECTED_BY_USER_ERROR, terminalizeNonExecutingDecisions } from "../approval-decisions.js";

describe("terminalizeNonExecutingDecisions", () => {
  function statusWith(
    toolCalls: Array<{ id: string; status: ToolCallStatus; approvalAction: ApprovalAction }>,
  ) {
    return create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          toolCalls: toolCalls.map(tc =>
            create(ToolCallSchema, {
              id: tc.id,
              name: "test_tool",
              status: tc.status,
              approvalAction: tc.approvalAction,
            }),
          ),
        }),
      ],
    });
  }

  it("terminalizes a REJECT decision to SKIPPED with the pinned reason (does not FAIL)", () => {
    const status = statusWith([{
      id: "call-reject",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.REJECT,
    }]);

    terminalizeNonExecutingDecisions(status);

    const tc = status.messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.error).toBe(REJECTED_BY_USER_ERROR);
    // The REJECT decision is preserved so the audit trail stays honest.
    expect(tc.approvalAction).toBe(ApprovalAction.REJECT);
  });

  it("terminalizes a SKIP decision to SKIPPED (fixes the stuck-WAITING for skip too)", () => {
    const status = statusWith([{
      id: "call-skip",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.SKIP,
    }]);

    terminalizeNonExecutingDecisions(status);

    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("leaves APPROVE / APPROVE_ALL untouched (the tool executes)", () => {
    const status = statusWith([
      { id: "call-approve", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, approvalAction: ApprovalAction.APPROVE },
      { id: "call-approve-all", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, approvalAction: ApprovalAction.APPROVE_ALL },
    ]);

    terminalizeNonExecutingDecisions(status);

    // Still WAITING — real tool events (not this reconciler) terminalize them.
    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(status.messages[0].toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("settles sub-agent transcripts too", () => {
    const status = create(AgentExecutionStatusSchema, {
      subAgentExecutions: [
        create(SubAgentExecutionSchema, {
          id: "sub-1",
          messages: [
            create(AgentMessageSchema, {
              toolCalls: [create(ToolCallSchema, {
                id: "sub-call-skip",
                name: "test_tool",
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                approvalAction: ApprovalAction.SKIP,
              })],
            }),
          ],
        }),
      ],
    });

    terminalizeNonExecutingDecisions(status);

    expect(status.subAgentExecutions[0].messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("is a no-op when there are no decided tool calls", () => {
    const status = statusWith([{
      id: "call-pending",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.UNSPECIFIED,
    }]);

    expect(() => terminalizeNonExecutingDecisions(status)).not.toThrow();
    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });
});
