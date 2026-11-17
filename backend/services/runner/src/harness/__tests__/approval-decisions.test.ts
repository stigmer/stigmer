/**
 * `harness/approval-decisions.ts` — the runtime's one settler of a person's
 * decision on a call that did not execute. These arms came with the
 * function from the Stigmer harness's `hitl.ts`
 * (`reconcileNonExecutingDecisions`, in #1096): SKIP and REJECT settle to
 * SKIPPED (REJECT with the pinned reason) on every outcome, sub-agent
 * transcripts are settled alike, and an undecided row is untouched. An
 * approved call is left to the engine's own events while the run goes on;
 * once the turn's outcome ends the run, an approved row still WAITING is a
 * call the engine never re-ran, and it settles FAILED with the sentence the
 * person reads (stigmer#2915). The reader half (`approvalAnswersOf`) is
 * exercised through `turn-context.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { APPROVED_NOT_RUN_ERROR, REJECTED_BY_USER_ERROR, terminalizeNonExecutingDecisions } from "../approval-decisions.js";
import type { TurnOutcome } from "../types.js";
import { AgentMessageSchema, ToolCallSchema, SubAgentRunSchema, TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

type OutcomeKind = TurnOutcome["kind"];

/** The outcomes after which nothing of this run executes again. */
const ENDING: readonly OutcomeKind[] = ["completed", "failed", "tool_call_limit"];
/** The outcomes after which a WAITING row is still answered: a new ask, or a yield the next invocation resumes. */
const CONTINUING: readonly OutcomeKind[] = ["awaiting_approval", "interrupted"];
const EVERY: readonly OutcomeKind[] = [...ENDING, ...CONTINUING];

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
  describe.each(EVERY)("after a %s outcome", (outcome) => {
    it("terminalizes a REJECT decision to SKIPPED with the pinned reason (does not FAIL)", () => {
      const rows = rowsWith([{ id: "call-reject", status: WAITING, approvalAction: ApprovalAction.REJECT }]);

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual([]);

      const tc = rows.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
      expect(tc.error).toBe(REJECTED_BY_USER_ERROR);
      // The REJECT decision is preserved so the audit trail stays honest.
      expect(tc.approvalAction).toBe(ApprovalAction.REJECT);
    });

    it("terminalizes a SKIP decision to SKIPPED (fixes the stuck-WAITING for skip too)", () => {
      const rows = rowsWith([{ id: "call-skip", status: WAITING, approvalAction: ApprovalAction.SKIP }]);

      terminalizeNonExecutingDecisions(rows, outcome);

      expect(rows.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    });

    it("leaves an undecided row alone", () => {
      const rows = rowsWith([{ id: "call-pending", status: WAITING, approvalAction: ApprovalAction.UNSPECIFIED }]);

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual([]);
      expect(rows.messages[0].toolCalls[0].status).toBe(WAITING);
    });

    it("never touches an approved call that ran, whatever its end", () => {
      const rows = rowsWith([
        { id: "call-done", status: ToolCallStatus.TOOL_CALL_COMPLETED, approvalAction: ApprovalAction.APPROVE },
        { id: "call-broke", status: ToolCallStatus.TOOL_CALL_FAILED, approvalAction: ApprovalAction.APPROVE_ALL, error: "exit 1" },
        { id: "call-running", status: ToolCallStatus.TOOL_CALL_RUNNING, approvalAction: ApprovalAction.APPROVE },
      ]);

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual([]);
      expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual([
        [ToolCallStatus.TOOL_CALL_COMPLETED, ""],
        [ToolCallStatus.TOOL_CALL_FAILED, "exit 1"],
        [ToolCallStatus.TOOL_CALL_RUNNING, ""],
      ]);
    });

    it("settles sub-agent transcripts too", () => {
      const rows = subAgentRowsWith({ id: "sub-call-skip", status: WAITING, approvalAction: ApprovalAction.SKIP });

      terminalizeNonExecutingDecisions(rows, outcome);

      expect(rows.subAgentRuns[0].messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    });
  });

  describe.each(ENDING)("an approved call still waiting after a %s outcome never ran", (outcome) => {
    it("settles FAILED with the sentence the person reads, keeps the decision, and returns its id", () => {
      const rows = rowsWith([
        { id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE },
        { id: "call-approve-all", status: WAITING, approvalAction: ApprovalAction.APPROVE_ALL },
      ]);

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual(["call-approve", "call-approve-all"]);

      expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error, tc.approvalAction])).toEqual([
        [ToolCallStatus.TOOL_CALL_FAILED, APPROVED_NOT_RUN_ERROR, ApprovalAction.APPROVE],
        [ToolCallStatus.TOOL_CALL_FAILED, APPROVED_NOT_RUN_ERROR, ApprovalAction.APPROVE_ALL],
      ]);
    });

    it("keeps an error the row already carries", () => {
      const rows = rowsWith([{ id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE, error: "the engine's own word" }]);

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual(["call-approve"]);
      expect([rows.messages[0].toolCalls[0].status, rows.messages[0].toolCalls[0].error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, "the engine's own word"]);
    });

    it("settles a sub-agent's approved call alike", () => {
      const rows = subAgentRowsWith({ id: "sub-call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE });

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual(["sub-call-approve"]);
      const tc = rows.subAgentRuns[0].messages[0].toolCalls[0];
      expect([tc.status, tc.error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, APPROVED_NOT_RUN_ERROR]);
    });

    it("is idempotent: a second pass settles nothing more and returns no id", () => {
      const rows = rowsWith([{ id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE }]);
      terminalizeNonExecutingDecisions(rows, outcome);
      const once = structuredClone(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error]));

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual([]);
      expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual(once);
    });
  });

  describe.each(CONTINUING)("an approved call still waiting after a %s outcome is still owed", (outcome) => {
    it("is left WAITING for the invocation that runs it", () => {
      const rows = rowsWith([
        { id: "call-approve", status: WAITING, approvalAction: ApprovalAction.APPROVE },
        { id: "call-approve-all", status: WAITING, approvalAction: ApprovalAction.APPROVE_ALL },
      ]);

      expect(terminalizeNonExecutingDecisions(rows, outcome)).toEqual([]);
      expect(rows.messages[0].toolCalls.map(tc => [tc.status, tc.error])).toEqual([[WAITING, ""], [WAITING, ""]]);
    });
  });
});
