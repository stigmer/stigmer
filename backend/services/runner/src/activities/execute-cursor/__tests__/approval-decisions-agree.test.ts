/**
 * Two readers of one fact must agree: the turn runtime reads the person's
 * answers as the VERDICT, from the session's log onto the WAITING rows
 * (`harness/approval-answers.ts` `approvalAnswersOf`, the
 * `TurnInput.approvalDecisions` the contract carries), and this adapter reads
 * the same rows, by the stamp the server writes with each answer, for the
 * FACTS beside the verdict (the pending-approval protos the grant builder and
 * the reinvocation prompt render, the content digest that authorizes an
 * approved edit by its exact bytes — `reconstructAdjudicatedApprovals`). The
 * contract's rule is that an adapter never re-derives the verdict itself, so
 * the two must select the same rows in the same order, with the same
 * verdict, or the grants would be minted for a different set than the
 * runtime decided on. The server's answer core writes the event and the
 * stamp in one transaction (`__test-utils__/approval-log.ts` models it).
 *
 * Lives on the adapter's side because `src/harness/` never imports
 * `src/activities/`, tests included (`harness/__tests__/import-direction.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { approvalAnswersOf } from "../../../harness/approval-answers.js";
import { answerEventsFor, stampedActionOf } from "../../../__test-utils__/approval-log.js";
import { reconstructAdjudicatedApprovals } from "../approval-state.js";

const RUN = "run_agree";

describe("the runtime's approvalAnswersOf and the adapter's reconstructAdjudicatedApprovals", () => {
  it("select the same rows in the same order, with the same verdict, over every row shape a transcript carries", () => {
    const log: SessionEvent[] = [];
    const answered = (row: ToolCall, action: ApprovalAction): ToolCall => {
      log.push(...answerEventsFor({ sessionId: "ses_agree", runId: RUN }, row, action));
      row.approvalAction = stampedActionOf(action);
      return row;
    };
    const status = create(RunStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            answered(
              create(ToolCallSchema, {
                id: "tc-approved",
                name: "Shell",
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                approvalContentDigest: "sha256:approved",
              }),
              ApprovalAction.APPROVE,
            ),
            create(ToolCallSchema, {
              id: "tc-undecided",
              name: "Shell",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
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
            answered(create(ToolCallSchema, { id: "tc-skipped", name: "Write", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL }), ApprovalAction.SKIP),
            answered(create(ToolCallSchema, { id: "tc-rejected", name: "Write", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL }), ApprovalAction.REJECT),
            answered(create(ToolCallSchema, { id: "tc-all", name: "Write", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL }), ApprovalAction.APPROVE_ALL),
          ],
        }),
      ],
    });

    const runtime = approvalAnswersOf(RUN, status, log).decisions;
    const adapter = reconstructAdjudicatedApprovals(status.messages);

    expect([...runtime.entries()]).toEqual([...adapter.decisions.entries()]);
    expect(
      adapter.pendingApprovals.map((pa) => pa.toolCallId),
      "the adapter's row facts cover exactly the rows the runtime decided on",
    ).toEqual([...runtime.keys()]);
    expect([...runtime.entries()]).toEqual([
      ["tc-approved", ApprovalAction.APPROVE],
      ["tc-skipped", ApprovalAction.REJECT],
      ["tc-rejected", ApprovalAction.REJECT],
      ["tc-all", ApprovalAction.APPROVE_ALL],
    ]);
  });

  it("both read nothing from a fresh transcript", () => {
    const status = create(RunStatusSchema, {});
    expect(approvalAnswersOf(RUN, status, []).decisions.size).toBe(0);
    expect(reconstructAdjudicatedApprovals(status.messages).decisions.size).toBe(0);
  });
});
