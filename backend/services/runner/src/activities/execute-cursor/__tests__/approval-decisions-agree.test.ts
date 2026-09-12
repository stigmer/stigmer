/**
 * Two readers of one fact must agree: the turn runtime reads the adjudicated
 * approvals as the VERDICT (`harness/turn-context.ts` `approvalDecisionsOf`,
 * the `TurnInput.approvalDecisions` the contract carries) and this adapter
 * reads the same rows for the FACTS beside the verdict (the pending-approval
 * protos the grant builder and the reinvocation prompt render, the content
 * digest that authorizes an approved edit by its exact bytes —
 * `reconstructAdjudicatedApprovals`). The contract's rule is that an adapter
 * never re-derives the verdict itself, so the two functions must select the
 * same rows in the same order or the grants would be minted for a different
 * set than the runtime decided on.
 *
 * Lives on the adapter's side because `src/harness/` never imports
 * `src/activities/`, tests included (`harness/__tests__/import-direction.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { approvalDecisionsOf } from "../../../harness/approval-decisions.js";
import { reconstructAdjudicatedApprovals } from "../approval-state.js";

describe("the runtime's approvalDecisionsOf and the adapter's reconstructAdjudicatedApprovals", () => {
  it("select the same rows in the same order over every row shape a transcript carries", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            create(ToolCallSchema, {
              id: "tc-approved",
              name: "Shell",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              approvalAction: ApprovalAction.APPROVE,
              approvalContentDigest: "sha256:approved",
            }),
            create(ToolCallSchema, {
              id: "tc-undecided",
              name: "Shell",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              approvalAction: ApprovalAction.UNSPECIFIED,
            }),
          ],
        }),
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            create(ToolCallSchema, {
              id: "tc-completed",
              name: "Read",
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
              approvalAction: ApprovalAction.APPROVE,
            }),
            create(ToolCallSchema, {
              id: "tc-skipped",
              name: "Write",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              approvalAction: ApprovalAction.SKIP,
            }),
            create(ToolCallSchema, {
              id: "tc-rejected",
              name: "Write",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              approvalAction: ApprovalAction.REJECT,
            }),
          ],
        }),
      ],
    });

    const runtime = approvalDecisionsOf(status);
    const adapter = reconstructAdjudicatedApprovals(status.messages);

    expect([...runtime.entries()]).toEqual([...adapter.decisions.entries()]);
    expect(
      adapter.pendingApprovals.map((pa) => pa.toolCallId),
      "the adapter's row facts cover exactly the rows the runtime decided on",
    ).toEqual([...runtime.keys()]);
    expect([...runtime.keys()]).toEqual(["tc-approved", "tc-skipped", "tc-rejected"]);
  });

  it("both read nothing from a fresh transcript", () => {
    const status = create(AgentExecutionStatusSchema, {});
    expect(approvalDecisionsOf(status).size).toBe(0);
    expect(reconstructAdjudicatedApprovals(status.messages).decisions.size).toBe(0);
  });
});
