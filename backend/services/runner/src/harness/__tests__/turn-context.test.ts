/**
 * Pins the turn context's pure decisions — the three places `turn-context.ts`
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
 *  - `decideReinvocation`: the three ways a resume proceeds (any decision
 *    runs the agent — REJECT included since S3 M1 —, a clean file-review
 *    resume completes, a failed or partially discarded one completes with
 *    its facts carried).
 *
 * The phases that fetch and provision are exercised end to end by the
 * hermetic goldens (`activities/execute-cursor/__tests__/hermetic/`), which
 * pin their observable behavior byte for byte; nothing here re-drives a
 * client.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema, AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { approvalDecisionsOf } from "../approval-decisions.js";
import { decideReinvocation, isReinvocation, type ReinvocationFacts } from "../turn-context.js";

const INPUT = { executionId: "aex_1", threadId: "", turnSeq: 0 } as const;

/** An execution with no persisted history (a first run) or with `n` persisted AI rows (a continuation). */
function executionWithTranscript(rows: number) {
  return create(AgentExecutionSchema, {
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
  return create(AgentExecutionStatusSchema, {
    messages: [
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [waitingApproved, waitingUndecided] }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [completedWithStaleAction, waitingRejected] }),
    ],
    subAgentExecutions: [
      create(SubAgentExecutionSchema, {
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
    expect(approvalDecisionsOf(create(AgentExecutionStatusSchema, {})).size).toBe(0);
  });
});

function facts(overrides: Partial<ReinvocationFacts> = {}): ReinvocationFacts {
  return {
    approvalDecisions: new Map(),
    reconciledFileReview: false,
    fileReviewFailed: false,
    fileReviewFailureDetail: "",
    discardedPaths: [],
    ...overrides,
  };
}

describe("decideReinvocation", () => {
  it("a first turn, or a resume that decided nothing and reconciled nothing, runs the agent", () => {
    expect(decideReinvocation(facts())).toBeUndefined();
  });

  it("a REJECT runs the agent like any other decision — the run continues without the tool (stigmer#197; S3 M1, Q-S3-2)", () => {
    // Until S3 M1 this returned `{ kind: "rejected-by-user" }` and the runtime
    // FAILED the execution before any engine ran, contradicting the proto, the
    // conformance suite and the native harness (S2 M4 finding F1).
    const decisions = new Map([
      ["tc-1", ApprovalAction.APPROVE],
      ["tc-2", ApprovalAction.REJECT],
    ]);
    expect(decideReinvocation(facts({ approvalDecisions: decisions }))).toBeUndefined();
    expect(decideReinvocation(facts({ approvalDecisions: new Map([["tc-2", ApprovalAction.REJECT]]) }))).toBeUndefined();
  });

  it("any adjudicated decision runs the agent, even when file review was also reconciled", () => {
    const decisions = new Map([["tc-1", ApprovalAction.APPROVE]]);
    expect(decideReinvocation(facts({ approvalDecisions: decisions, reconciledFileReview: true }))).toBeUndefined();
    expect(decideReinvocation(facts({ approvalDecisions: new Map([["tc-1", ApprovalAction.SKIP]]) }))).toBeUndefined();
  });

  it("a pure file-review resume completes, carrying the reconcile's facts", () => {
    expect(decideReinvocation(facts({ reconciledFileReview: true }))).toEqual({
      kind: "file-review-resolved",
      failed: false,
      failureDetail: "",
      discardedPaths: [],
    });
    expect(
      decideReinvocation(
        facts({
          reconciledFileReview: true,
          fileReviewFailed: true,
          fileReviewFailureDetail: "src/a.ts changed after review",
          discardedPaths: ["src/b.ts"],
        }),
      ),
    ).toEqual({
      kind: "file-review-resolved",
      failed: true,
      failureDetail: "src/a.ts changed after review",
      discardedPaths: ["src/b.ts"],
    });
  });
});
