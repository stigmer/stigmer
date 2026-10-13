/**
 * Two readers of one log must agree: the turn runtime reads the person's
 * answers as the VERDICT, from the session's log onto the WAITING rows
 * (`harness/approval-answers.ts` `approvalAnswersOf`, the
 * `TurnInput.approvalDecisions` the contract carries), and this adapter
 * reads the same rows for the FACTS beside the verdict (the pending-approval
 * protos the grant builder and the reinvocation prompt render, the content
 * digest that authorizes an approved edit by its exact bytes, whether a hook
 * asked — `reconstructAdjudicatedApprovals`), taking the verdicts and the
 * asks from what the runtime read. The contract's rule is that an adapter
 * never re-derives the verdict itself, so the two must select the same rows
 * in the same order, with the same verdict, or the grants would be minted
 * for a different set than the runtime decided on. And what a call was asked
 * under comes from its `stigmer.permission.asked`, never from the row: a row
 * carrying a stale digest, policy source or server stamp changes nothing.
 *
 * Lives on the adapter's side because `src/harness/` never imports
 * `src/activities/`, tests included (`harness/__tests__/import-direction.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { ApprovalAction, ApprovalPolicySource, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { approvalAnswersOf } from "../../../harness/approval-answers.js";
import { toolUseEventId } from "../../../harness/events/ids.js";
import { answerEventsFor } from "../../../__test-utils__/approval-log.js";
import { reconstructAdjudicatedApprovals } from "../approval-state.js";

const RUN = "run_agree";

/** The ask the emitter wrote for `row`, under `policySource` and `contentDigest`. */
function asked(row: ToolCall, policySource: string, contentDigest = ""): SessionEvent {
  const toolUseId = toolUseEventId(RUN, row.id);
  return create(SessionEventSchema, {
    runId: RUN,
    event: { case: "stigmerPermissionAsked", value: { id: `${toolUseId}.ask`, toolUseId, policySource, contentDigest } },
  });
}

describe("the runtime's approvalAnswersOf and the adapter's reconstructAdjudicatedApprovals", () => {
  it("select the same rows in the same order, with the same verdict, over every row shape a transcript carries", () => {
    const log: SessionEvent[] = [];
    const answered = (row: ToolCall, action: ApprovalAction, policySource = "builtin_category", digest = ""): ToolCall => {
      log.push(asked(row, policySource, digest), ...answerEventsFor({ sessionId: "ses_agree", runId: RUN }, row, action));
      return row;
    };
    type Stale = { approvalContentDigest?: string; approvalPolicySource?: ApprovalPolicySource; approvalAction?: ApprovalAction };
    const waiting = (id: string, name: string, extra: Stale = {}): ToolCall =>
      create(ToolCallSchema, { id, name, status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, ...extra });
    const status = create(RunStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            // The row's own digest, policy source and a stamp are stale: the log's ask and answer stand.
            answered(
              waiting("tc-approved", "Write", {
                approvalContentDigest: "sha256:stale",
                approvalPolicySource: ApprovalPolicySource.HOOK,
                approvalAction: ApprovalAction.REJECT,
              }),
              ApprovalAction.APPROVE,
              "builtin_category",
              "sha256:approved",
            ),
            waiting("tc-undecided", "Shell", { approvalAction: ApprovalAction.APPROVE }),
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
            answered(waiting("tc-skipped", "Write"), ApprovalAction.SKIP),
            answered(waiting("tc-rejected", "Shell"), ApprovalAction.REJECT, "hook", "args:abc"),
            answered(waiting("tc-all", "Write"), ApprovalAction.APPROVE_ALL),
          ],
        }),
      ],
    });

    const runtime = approvalAnswersOf(RUN, status, log);
    const adapter = reconstructAdjudicatedApprovals(status.messages, { runId: RUN, decisions: runtime.decisions, asks: runtime.asks });

    expect([...runtime.decisions.entries()]).toEqual([...adapter.decisions.entries()]);
    expect(
      adapter.pendingApprovals.map((pa) => pa.toolCallId),
      "the adapter's row facts cover exactly the rows the runtime decided on",
    ).toEqual([...runtime.decisions.keys()]);
    expect([...runtime.decisions.entries()]).toEqual([
      ["tc-approved", ApprovalAction.APPROVE],
      ["tc-skipped", ApprovalAction.REJECT],
      ["tc-rejected", ApprovalAction.REJECT],
      ["tc-all", ApprovalAction.APPROVE_ALL],
    ]);
    expect([...adapter.contentDigests.entries()], "each digest is the ask's, never the row's").toEqual([
      ["tc-approved", "sha256:approved"],
      ["tc-skipped", ""],
      ["tc-rejected", "args:abc"],
      ["tc-all", ""],
    ]);
    expect([...adapter.hookAsked], "a hook asked only where the ask says so").toEqual(["tc-rejected"]);
  });

  it("degrades a decided row whose ask the log does not hold to no digest and no hook", () => {
    const row = create(ToolCallSchema, {
      id: "tc-no-ask",
      name: "Write",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalContentDigest: "sha256:on-the-row",
      args: { path: "a.md", contents: "x" },
    });
    const messages = [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [row] })];
    const adapter = reconstructAdjudicatedApprovals(messages, {
      runId: RUN,
      decisions: new Map([["tc-no-ask", ApprovalAction.APPROVE]]),
      asks: new Map(),
    });
    expect([...adapter.contentDigests.entries()]).toEqual([["tc-no-ask", ""]]);
    expect(adapter.hookAsked.size).toBe(0);
  });

  it("both read nothing from a fresh transcript", () => {
    const status = create(RunStatusSchema, {});
    const runtime = approvalAnswersOf(RUN, status, []);
    expect(runtime.decisions.size).toBe(0);
    expect(reconstructAdjudicatedApprovals(status.messages, { runId: RUN, decisions: runtime.decisions, asks: runtime.asks }).decisions.size).toBe(0);
  });
});
