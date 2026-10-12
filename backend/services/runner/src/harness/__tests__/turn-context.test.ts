/**
 * Pins the turn context's pure decisions — the places `turn-context.ts`
 * decides something rather than fetching it:
 *
 *  - `isReinvocation`: the runtime's one reading of "does this invocation
 *    resume rather than begin", keyed on how the harness mints its state id.
 *    The engine-minted arm is `!!threadId`; the deterministic arm is the
 *    persisted transcript's non-emptiness, whatever the thread id says (the
 *    id exists on the first turn too), and never the live engine checkpoint.
 *  - `approvalDecisionsOf` (`approval-decisions.ts`): the runtime's reader of adjudicated approvals,
 *    over a transcript that carries every row shape it must include or
 *    exclude. Its agreement with the Cursor adapter's own reader
 *    (`reconstructAdjudicatedApprovals`) is pinned from the adapter's side
 *    (`activities/execute-cursor/__tests__/approval-state.test.ts`), because
 *    `src/harness/` never imports `src/activities/`, tests included.
 *  - `fileReviewOn`: a turn's file review is on when the session asks for
 *    it or the run is a plugin-eval try, and off otherwise (the default).
 *  - `reconcileTurnSettlement`: a reconcile turn completes, its rows naming
 *    the files put back, or the failures when any undo failed.
 *  - `regeneratesApprovedWrites`: which pause primitives make the runner pin
 *    an approved whole-file write's bytes itself (the engine re-runs the
 *    model) and which never do (the engine applies the exact args it paused
 *    on).
 *
 * The phases that fetch and provision are exercised end to end by the
 * hermetic goldens (`activities/execute-cursor/__tests__/hermetic/`), which
 * pin their observable behavior byte for byte; nothing here re-drives a
 * client.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { SubAgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/subagent_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { approvalDecisionsOf } from "../approval-decisions.js";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { fileReviewOn, isReinvocation, reconcileTurnSettlement, regeneratesApprovedWrites } from "../turn-context.js";

const INPUT = { executionId: "aex_1", threadId: "", turnSeq: 0 } as const;

/** An execution with no persisted history (a first run) or with `n` persisted AI rows (a continuation). */
function executionWithTranscript(rows: number) {
  return create(RunSchema, {
    status: {
      messages: Array.from({ length: rows }, (_, i) =>
        create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: `row ${i}` }),
      ),
    },
  });
}
const FIRST_RUN = executionWithTranscript(0);
const CONTINUATION = executionWithTranscript(1);

describe("isReinvocation", () => {
  it("engine-minted: an empty state id is a first turn, any id is a resume", () => {
    expect(isReinvocation("engine-minted", INPUT, FIRST_RUN)).toBe(false);
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42" }, FIRST_RUN)).toBe(true);
  });

  it("engine-minted: turnSeq is NOT the signal (a pure-reconcile turn does not advance it; the legacy wire shape yields 0)", () => {
    expect(isReinvocation("engine-minted", { ...INPUT, turnSeq: 3 }, FIRST_RUN)).toBe(false);
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42", turnSeq: 0 }, FIRST_RUN)).toBe(true);
  });

  it("engine-minted: the transcript is NOT the signal (the bound id is; a follow-up turn with a bound id and an empty transcript still resumes the engine)", () => {
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42" }, FIRST_RUN)).toBe(true);
    expect(isReinvocation("engine-minted", INPUT, CONTINUATION)).toBe(false);
  });

  it("deterministic: the persisted transcript is the signal — empty is a first run, any committed history is a continuation", () => {
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "thread-ses_1" }, FIRST_RUN)).toBe(false);
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "thread-ses_1" }, CONTINUATION)).toBe(true);
  });

  it("deterministic: the thread id is NOT the signal (a deterministic harness has one on its first turn too)", () => {
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "thread-ses_1", turnSeq: 0 }, FIRST_RUN)).toBe(false);
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "", turnSeq: 0 }, CONTINUATION)).toBe(true);
  });
});

/** A transcript carrying every row shape the reader must include or exclude. */
function transcriptWithEveryRowShape() {
  const waitingApproved = create(ToolCallSchema, {
    id: "tc-approved",
    name: "Shell",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction: ApprovalAction.APPROVE,
    approvalContentDigest: "sha256:approved",
  });
  const waitingRejected = create(ToolCallSchema, {
    id: "tc-rejected",
    name: "Write",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction: ApprovalAction.REJECT,
  });
  const waitingUndecided = create(ToolCallSchema, {
    id: "tc-undecided",
    name: "Shell",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction: ApprovalAction.UNSPECIFIED,
  });
  const completedWithStaleAction = create(ToolCallSchema, {
    id: "tc-completed",
    name: "Read",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    approvalAction: ApprovalAction.APPROVE,
  });
  const subAgentWaiting = create(ToolCallSchema, {
    id: "tc-sub",
    name: "Shell",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction: ApprovalAction.APPROVE,
  });
  return create(RunStatusSchema, {
    messages: [
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [waitingApproved, waitingUndecided] }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [completedWithStaleAction, waitingRejected] }),
    ],
    subAgentRuns: [
      create(SubAgentRunSchema, {
        messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [subAgentWaiting] })],
      }),
    ],
  });
}

describe("approvalDecisionsOf", () => {
  it("reads every WAITING row with a verdict, in transcript order, and nothing else", () => {
    const decisions = approvalDecisionsOf(transcriptWithEveryRowShape());
    expect([...decisions.entries()]).toEqual([
      ["tc-approved", ApprovalAction.APPROVE],
      ["tc-rejected", ApprovalAction.REJECT],
    ]);
  });

  it("an undecided WAITING row, a COMPLETED row with a stale verdict, and a sub-agent row are all excluded", () => {
    const decisions = approvalDecisionsOf(transcriptWithEveryRowShape());
    expect(decisions.has("tc-undecided"), "no verdict yet").toBe(false);
    expect(decisions.has("tc-completed"), "already executed; the verdict on it is history").toBe(false);
    expect(decisions.has("tc-sub"), "sub-agent transcripts are not the top-level rows").toBe(false);
  });

  it("is empty on a fresh status", () => {
    expect(approvalDecisionsOf(create(RunStatusSchema, {})).size).toBe(0);
  });
});

describe("fileReviewOn", () => {
  const session = (fileReview: boolean) => create(SessionSchema, { spec: { fileReview } });
  const message = create(RunSpecSchema, { message: "Edit the notes." });
  const evalTry = create(RunSpecSchema, { message: "Edit the notes.", pluginEvalCase: {} });

  it("is off unless the session asks for it", () => {
    expect(fileReviewOn(session(false), message)).toBe(false);
    expect(fileReviewOn(create(SessionSchema, {}), message)).toBe(false);
    expect(fileReviewOn(session(true), message)).toBe(true);
  });

  it("is on for a plugin-eval try whatever the switch says: its graders read the captured sets", () => {
    expect(fileReviewOn(session(false), evalTry)).toBe(true);
    expect(fileReviewOn(session(true), evalTry)).toBe(true);
  });
});

describe("reconcileTurnSettlement", () => {
  it("nothing owed: a reconcile turn completes with nothing to say", () => {
    expect(reconcileTurnSettlement([])).toEqual({ kind: "file-review-resolved", failed: false, failureDetail: "", discardedPaths: [] });
  });

  it("names every file put back, across change sets", () => {
    expect(
      reconcileTurnSettlement([
        { changeSetId: "run_a:0", undonePaths: ["a.md"], failure: "", failureDetail: "" },
        { changeSetId: "run_b:0", undonePaths: ["b.md", "c.md"], failure: "", failureDetail: "" },
      ]),
    ).toEqual({ kind: "file-review-resolved", failed: false, failureDetail: "", discardedPaths: ["a.md", "b.md", "c.md"] });
  });

  it("a failed undo fails the settlement's copy and carries its detail", () => {
    expect(
      reconcileTurnSettlement([
        { changeSetId: "run_a:0", undonePaths: [], failure: "hash_mismatch", failureDetail: "a.md changed" },
        { changeSetId: "run_b:0", undonePaths: ["b.md"], failure: "", failureDetail: "" },
      ]),
    ).toEqual({ kind: "file-review-resolved", failed: true, failureDetail: "a.md changed", discardedPaths: ["b.md"] });
  });
});

describe("regeneratesApprovedWrites", () => {
  it("a deny-and-retry engine re-prompts the model with grants, so the runner pins the approved bytes", () => {
    expect(regeneratesApprovedWrites("deny-and-retry")).toBe(true);
  });

  it("a callback engine's resumed session re-attempts the call, so the runner pins the approved bytes", () => {
    expect(regeneratesApprovedWrites("callback")).toBe(true);
  });

  it("an interrupt engine applies the exact args it paused on — a runner-side write would land twice and pre-empt the row", () => {
    expect(regeneratesApprovedWrites("interrupt")).toBe(false);
  });

  it("a gate-less engine has nothing approved to apply", () => {
    expect(regeneratesApprovedWrites("none")).toBe(false);
  });
});
