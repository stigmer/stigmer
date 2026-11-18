/**
 * `harness/approval-decisions.ts` — the runtime's one settler of a person's
 * decision on a call that did not execute. These arms came with the
 * function from the Stigmer harness's `hitl.ts`
 * (`reconcileNonExecutingDecisions`, in #1096): SKIP and REJECT settle to
 * SKIPPED (REJECT with the pinned reason) on every outcome, APPROVE and
 * APPROVE_ALL are left to the engine's own events, sub-agent transcripts
 * are settled alike, and an undecided row is untouched. It returns the ids
 * it moved out of WAITING, so the runtime's ended-run settle knows a run
 * that ended during setup owes the person's card a result (stigmer#3289).
 *
 * An approved call still WAITING on a run that has ended is a call that
 * never ran, and `settleApprovedNotRun` settles it FAILED with the sentence
 * the person reads (stigmer#2915, stigmer#3277). Whether the run has ended is
 * the runtime's terminal arm's to say (`run-turn.ts` calls it at its two
 * completion writers; `run-turn.test.ts` drives every ending); here are the
 * settle's own facts, and the contract kit's replay of where the runtime
 * calls it, pinned against the real arms of the terminal table. The reader
 * half (`approvalAnswersOf`) is exercised through `turn-context.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { APPROVED_NOT_RUN_ERROR, REJECTED_BY_USER_ERROR, settleApprovedNotRun, terminalizeNonExecutingDecisions } from "../approval-decisions.js";
import { awaitingApprovalArm, failedArm, toolCallLimitArm } from "../terminal-table.js";
import { outcomeCompletesTheRun } from "../../__test-utils__/harness-contract/contract.js";
import { AgentMessageSchema, ToolCallSchema, SubAgentRunSchema, TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

interface RowSpec {
  readonly id: string;
  readonly status: ToolCallStatus;
  readonly approvalAction: ApprovalAction;
  readonly error?: string;
}

function rowsWith(toolCalls: readonly RowSpec[]) {
  return create(TurnRowsSchema, {
    messages: [
      create(AgentMessageSchema, {
        toolCalls: toolCalls.map(tc =>
          create(ToolCallSchema, {
            id: tc.id,
            name: "test_tool",
            status: tc.status,
            approvalAction: tc.approvalAction,
            error: tc.error ?? "",
          }),
        ),
      }),
    ],
  });
}

function subAgentRowsWith(toolCall: RowSpec) {
  return create(TurnRowsSchema, {
    subAgentRuns: [
      create(SubAgentRunSchema, {
        id: "sub-1",
        messages: [
          create(AgentMessageSchema, {
            toolCalls: [create(ToolCallSchema, { id: toolCall.id, name: "test_tool", status: toolCall.status, approvalAction: toolCall.approvalAction })],
          }),
        ],
      }),
    ],
  });
}

const WAITING = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;

describe("terminalizeNonExecutingDecisions", () => {
  it("terminalizes a REJECT decision to SKIPPED with the pinned reason (does not FAIL)", () => {
    const rows = rowsWith([{ id: "call-reject", status: WAITING, approvalAction: ApprovalAction.REJECT }]);

    expect(terminalizeNonExecutingDecisions(rows)).toEqual(["call-reject"]);

    const tc = rows.messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.error).toBe(REJECTED_BY_USER_ERROR);
    // The REJECT decision is preserved so the audit trail stays honest.
    expect(tc.approvalAction).toBe(ApprovalAction.REJECT);
  });

  it("terminalizes a SKIP decision to SKIPPED (fixes the stuck-WAITING for skip too)", () => {
    const rows = rowsWith([{ id: "call-skip", status: WAITING, approvalAction: ApprovalAction.SKIP }]);

    expect(terminalizeNonExecutingDecisions(rows)).toEqual(["call-skip"]);

    expect(rows.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("leaves APPROVE / APPROVE_ALL untouched (the tool executes)", () => {
    const rows = rowsWith([
      { id: "call-done", status: ToolCallStatus.TOOL_CALL_COMPLETED, approvalAction: ApprovalAction.APPROVE },
      { id: "call-broke", status: ToolCallStatus.TOOL_CALL_FAILED, approvalAction: ApprovalAction.APPROVE_ALL, error: "exit 1" },
      { id: "call-running", status: ToolCallStatus.TOOL_CALL_RUNNING, approvalAction: ApprovalAction.APPROVE },
      { id: "call-owed", status: WAITING, approvalAction: ApprovalAction.APPROVE },
      { id: "call-owed-all", status: WAITING, approvalAction: ApprovalAction.APPROVE_ALL },
    ]);

    // A call that ran is the engine's events' to settle; one still waiting is
    // owed to the invocation that resumes it, or to `settleApprovedNotRun`
    // once the run has ended. None of them is returned.
    expect(terminalizeNonExecutingDecisions(rows)).toEqual([]);
    expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual([
      [ToolCallStatus.TOOL_CALL_COMPLETED, ""],
      [ToolCallStatus.TOOL_CALL_FAILED, "exit 1"],
      [ToolCallStatus.TOOL_CALL_RUNNING, ""],
      [WAITING, ""],
      [WAITING, ""],
    ]);
  });

  it("settles sub-agent transcripts too", () => {
    const rows = subAgentRowsWith({ id: "sub-call-skip", status: WAITING, approvalAction: ApprovalAction.SKIP });

    expect(terminalizeNonExecutingDecisions(rows)).toEqual(["sub-call-skip"]);

    expect(rows.subAgentRuns[0].messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("is a no-op when there are no decided tool calls", () => {
    const rows = rowsWith([{ id: "call-pending", status: WAITING, approvalAction: ApprovalAction.UNSPECIFIED }]);

    expect(terminalizeNonExecutingDecisions(rows)).toEqual([]);

    expect(rows.messages[0].toolCalls[0].status).toBe(WAITING);
  });

  it("is idempotent: a second pass re-settles alike and returns no id", () => {
    const rows = rowsWith([
      { id: "call-reject", status: WAITING, approvalAction: ApprovalAction.REJECT },
      { id: "call-skip", status: WAITING, approvalAction: ApprovalAction.SKIP },
    ]);
    expect(terminalizeNonExecutingDecisions(rows)).toEqual(["call-reject", "call-skip"]);
    const once = structuredClone(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error]));

    expect(terminalizeNonExecutingDecisions(rows)).toEqual([]);
    expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual(once);
  });

  it("returns only the rows it moved out of WAITING: one an engine already settled SKIPPED is not returned", () => {
    const rows = rowsWith([
      { id: "call-settled", status: ToolCallStatus.TOOL_CALL_SKIPPED, approvalAction: ApprovalAction.REJECT, error: REJECTED_BY_USER_ERROR },
      { id: "call-reject", status: WAITING, approvalAction: ApprovalAction.REJECT },
    ]);

    expect(terminalizeNonExecutingDecisions(rows)).toEqual(["call-reject"]);
    expect(rows.messages[0].toolCalls.map(tc => tc.status)).toEqual([ToolCallStatus.TOOL_CALL_SKIPPED, ToolCallStatus.TOOL_CALL_SKIPPED]);
  });
});

describe("settleApprovedNotRun: the approved calls of a run that has ended", () => {
  it("settles an approved call still waiting FAILED with the sentence the person reads, keeps the decision, and returns its id", () => {
    const rows = rowsWith([
      { id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE },
      { id: "call-approve-all", status: WAITING, approvalAction: ApprovalAction.APPROVE_ALL },
    ]);

    expect(settleApprovedNotRun(rows)).toEqual(["call-approve", "call-approve-all"]);

    expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error, tc.approvalAction])).toEqual([
      [ToolCallStatus.TOOL_CALL_FAILED, APPROVED_NOT_RUN_ERROR, ApprovalAction.APPROVE],
      [ToolCallStatus.TOOL_CALL_FAILED, APPROVED_NOT_RUN_ERROR, ApprovalAction.APPROVE_ALL],
    ]);
  });

  it("keeps an error the row already carries", () => {
    const rows = rowsWith([{ id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE, error: "the engine's own word" }]);

    expect(settleApprovedNotRun(rows)).toEqual(["call-approve"]);
    expect([rows.messages[0].toolCalls[0].status, rows.messages[0].toolCalls[0].error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, "the engine's own word"]);
  });

  it("settles a sub-agent's approved call alike", () => {
    const rows = subAgentRowsWith({ id: "sub-call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE });

    expect(settleApprovedNotRun(rows)).toEqual(["sub-call-approve"]);
    const tc = rows.subAgentRuns[0].messages[0].toolCalls[0];
    expect([tc.status, tc.error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, APPROVED_NOT_RUN_ERROR]);
  });

  it("is idempotent: a second pass settles nothing more and returns no id", () => {
    const rows = rowsWith([{ id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE }]);
    settleApprovedNotRun(rows);
    const once = structuredClone(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error]));

    expect(settleApprovedNotRun(rows)).toEqual([]);
    expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual(once);
  });

  it("leaves every other row as it is: a call that ran, a SKIP, a REJECT, an unanswered ask", () => {
    const specs: RowSpec[] = [
      { id: "call-done", status: ToolCallStatus.TOOL_CALL_COMPLETED, approvalAction: ApprovalAction.APPROVE },
      { id: "call-running", status: ToolCallStatus.TOOL_CALL_RUNNING, approvalAction: ApprovalAction.APPROVE_ALL },
      { id: "call-skip", status: WAITING, approvalAction: ApprovalAction.SKIP },
      { id: "call-reject", status: WAITING, approvalAction: ApprovalAction.REJECT },
      { id: "call-pending", status: WAITING, approvalAction: ApprovalAction.UNSPECIFIED },
    ];
    const rows = rowsWith(specs);

    expect(settleApprovedNotRun(rows)).toEqual([]);
    expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual(specs.map(spec => [spec.status, ""]));
  });
});

describe("the contract kit's replay of where the runtime settles an approved call", () => {
  // The kit replays the runtime's bookkeeping without the runtime: it settles
  // an approved call once the outcome's arm completes the run. Pinned here
  // against the real arms, so the replay cannot drift from the table.
  // `completed` goes to `completeTurn`, which always stamps completion, and
  // `interrupted`'s arm is picked by stop evidence the kit does not hold.
  it.each([
    ["failed", failedArm("the engine stopped", "engine").completes],
    ["tool_call_limit", toolCallLimitArm().completes],
    ["awaiting_approval", awaitingApprovalArm().completes],
  ] as const)("a %s outcome completes the run exactly when its arm does", (outcome, completes) => {
    expect(outcomeCompletesTheRun(outcome)).toBe(completes);
  });

  it("a completed outcome ends the run; an interrupted one is left to the stop the runtime classifies", () => {
    expect([outcomeCompletesTheRun("completed"), outcomeCompletesTheRun("interrupted")]).toEqual([true, false]);
  });
});
