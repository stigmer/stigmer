/**
 * A later, same-identity proposal is a NEW act: it never lands on a row the
 * user already decided (S2 M4 finding F9).
 *
 * The defect the harness contract kit found against this adapter: within one
 * execution, after the user APPROVED `edit a.txt` and the resumed agent ran
 * it (its row COMPLETED, still carrying `approval_action = APPROVE`), the
 * model proposed the SAME edit again in a later turn. The hook denied it
 * (correct: no grant). The denial overlay then matched the denial to the
 * FIRST same-identity row in the whole transcript — the completed, approved
 * one — flipped it back to WAITING_APPROVAL with its APPROVE still on it and
 * wiped its result; the actual streamed call was hidden as a twin. On the next
 * invocation `approvalDecisionsOf` read that row as a decision and the new,
 * never-approved proposal ran under the old approval. The accumulator had the
 * sibling flaw: a re-issue after a SKIP or REJECT was reconciled onto the
 * declined row by identity, inheriting its decision.
 *
 * The rule, in `message-translator.ts`: a row the server has adjudicated
 * (`isAdjudicatedRow`) is never the home of THIS turn's denial and never a
 * twin to collapse; a row the user DECLINED (`isDeclinedRow`) is never the
 * home of a later same-identity call. The approved re-issue (the
 * `sequential-gate-resume` shape) still reconciles onto its APPROVE row — the
 * one case where the later call IS the decided act.
 *
 * Each arm ends by deriving the decisions the runtime would read from the
 * reconciled transcript (`approvalDecisionsOf`): the assertion that matters
 * is that nothing decided bleeds onto the new proposal.
 */

import { describe, it, expect } from "vitest";
import { create, clone } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";

import { approvalDecisionsOf } from "../../../harness/approval-decisions.js";
import { MessageAccumulator, reconcileDeniedToolCalls, toolCallIdentityToken } from "../message-translator.js";
import type { DeniedLedgerEntry } from "../approval-state.js";

const PATH = "/work/a.txt";
const CONTENT = "A\n";
const FIRST_ID = "tool_edit_first";
const LATER_ID = "tool_edit_later";
const RESULT_OF_FIRST = "wrote a.txt";

function toolCallEvent(
  callId: string,
  status: "running" | "completed" | "error",
  result?: unknown,
): Extract<SDKMessage, { type: "tool_call" }> {
  return { type: "tool_call", agent_id: "agent-1", run_id: "r3", call_id: callId, name: "edit", status, args: { path: PATH, content: CONTENT }, result };
}

/** The transcript after the first gate was decided `action` and, for an APPROVE, run. */
function decidedFirstGate(action: ApprovalAction): AgentMessage[] {
  const executed = action === ApprovalAction.APPROVE;
  return [
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "I'll write file A.",
      toolCalls: [
        create(ToolCallSchema, {
          id: FIRST_ID,
          name: "edit",
          status: executed ? ToolCallStatus.TOOL_CALL_COMPLETED : ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
          requiresApproval: true,
          approvalAction: action,
          args: { path: PATH, content: CONTENT },
          argsPreview: JSON.stringify({ path: PATH, content: CONTENT }),
          result: executed ? RESULT_OF_FIRST : "",
          completedAt: executed ? "2026-06-20T00:00:05.000Z" : "",
        }),
      ],
    }),
  ];
}

function allToolCalls(messages: AgentMessage[]): ToolCall[] {
  return messages.flatMap((m) => m.toolCalls);
}

/** The later turn: the model proposes the same edit under a fresh id, the hook denies it, the turn boundary reconciles. */
async function laterTurnProposesSameEdit(seeded: AgentMessage[]): Promise<ToolCall[]> {
  const acc = new MessageAccumulator(seeded, {});
  acc.processEvent(toolCallEvent(LATER_ID, "running"));
  acc.processEvent(toolCallEvent(LATER_ID, "error", "Blocked by hook"));
  acc.finalize();
  const ledger: DeniedLedgerEntry[] = [{ toolName: "Write", token: toolCallIdentityToken(allToolCalls(seeded).find((tc) => tc.id === LATER_ID)!) }];
  return reconcileDeniedToolCalls(seeded, ledger);
}

function decisionsTheRuntimeWouldRead(messages: AgentMessage[]): ReadonlyMap<string, ApprovalAction> {
  return approvalDecisionsOf(create(AgentExecutionStatusSchema, { messages }));
}

describe("a later same-identity proposal never lands on a decided row (F9)", () => {
  it("after APPROVE and execution: the completed row keeps its result and decision; the new call gets its own gate; nothing bleeds", async () => {
    const seeded = decidedFirstGate(ApprovalAction.APPROVE).map((m) => clone(AgentMessageSchema, m));

    const gated = await laterTurnProposesSameEdit(seeded);

    const byId = new Map(allToolCalls(seeded).map((tc) => [tc.id, tc]));
    const first = byId.get(FIRST_ID)!;
    expect(first.status, "the executed row is the transcript's record and is never rewritten").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(first.result).toBe(RESULT_OF_FIRST);
    expect(first.approvalAction).toBe(ApprovalAction.APPROVE);

    const later = byId.get(LATER_ID);
    expect(later, "the new act has its own row").toBeDefined();
    expect(later!.status, "and it is the turn's one gate").toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(later!.approvalAction, "undecided — the user has not been asked yet").toBe(ApprovalAction.UNSPECIFIED);
    expect(gated.map((tc) => tc.id)).toEqual([LATER_ID]);

    expect(decisionsTheRuntimeWouldRead(seeded).size, "no decision bleeds onto the new proposal").toBe(0);
  });

  it.each([
    ["SKIP", ApprovalAction.SKIP],
    ["REJECT", ApprovalAction.REJECT],
  ] as const)("after %s: the re-issue is not reconciled onto the declined row; it gets its own gate and inherits nothing", async (_label, action) => {
    const seeded = decidedFirstGate(action).map((m) => clone(AgentMessageSchema, m));

    const gated = await laterTurnProposesSameEdit(seeded);

    const byId = new Map(allToolCalls(seeded).map((tc) => [tc.id, tc]));
    const first = byId.get(FIRST_ID)!;
    expect(first.status, "the declined gate is untouched").toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(first.approvalAction).toBe(action);
    expect(first.error, "the later denial was not merged onto it").toBe("");

    const later = byId.get(LATER_ID);
    expect(later, "the re-issue is a new act with its own row").toBeDefined();
    expect(later!.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(later!.approvalAction).toBe(ApprovalAction.UNSPECIFIED);
    expect(gated.map((tc) => tc.id)).toEqual([LATER_ID]);

    const decisions = decisionsTheRuntimeWouldRead(seeded);
    expect(decisions.get(FIRST_ID), "the declined row's decision stays its own").toBe(action);
    expect(decisions.has(LATER_ID), "and is not the new proposal's").toBe(false);
  });

  it("the approved re-issue itself still reconciles onto its APPROVE row (the sequential-gate-resume shape is unchanged)", () => {
    const seeded = [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [
          create(ToolCallSchema, {
            id: FIRST_ID,
            name: "edit",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalAction: ApprovalAction.APPROVE,
            argsPreview: JSON.stringify({ path: PATH, content: CONTENT }),
          }),
        ],
      }),
    ];

    const acc = new MessageAccumulator(seeded, {});
    acc.processEvent(toolCallEvent(`${FIRST_ID}_RESUME`, "running"));
    acc.processEvent(toolCallEvent(`${FIRST_ID}_RESUME`, "completed", RESULT_OF_FIRST));
    acc.finalize();

    const tools = allToolCalls(seeded);
    expect(tools.map((tc) => tc.id), "one row, the committed id").toEqual([FIRST_ID]);
    expect(tools[0]!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tools[0]!.result).toBe(RESULT_OF_FIRST);
  });
});
