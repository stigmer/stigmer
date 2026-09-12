/**
 * Pins the turn context's pure decisions — the three places `turn-context.ts`
 * decides something rather than fetching it:
 *
 *  - `isReinvocation`: the one reading of "does the engine already hold state
 *    for this execution", keyed on how the harness mints its state id. The
 *    engine-minted arm is today's `!!threadId`; the deterministic arm refuses
 *    until the native adapter lands (S3), and the refusal is pinned so a
 *    future caller cannot get a silent `false`.
 *  - `approvalDecisionsOf`: the runtime's reader of adjudicated approvals,
 *    over a transcript that carries every row shape it must include or
 *    exclude. Its agreement with the Cursor adapter's own reader
 *    (`reconstructAdjudicatedApprovals`) is pinned from the adapter's side
 *    (`activities/execute-cursor/__tests__/approval-state.test.ts`), because
 *    `src/harness/` never imports `src/activities/`, tests included.
 *  - `decideReinvocation`: the four ways a resume proceeds (reject fails,
 *    approvals run, a clean file-review resume completes, a failed or
 *    partially discarded one completes with its facts carried).
 *
 * The phases that fetch and provision are exercised end to end by the
 * hermetic goldens (`activities/execute-cursor/__tests__/hermetic/`), which
 * pin their observable behavior byte for byte; nothing here re-drives a
 * client.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { approvalDecisionsOf, decideReinvocation, isReinvocation, type ReinvocationFacts } from "../turn-context.js";

const INPUT = { executionId: "aex_1", threadId: "", turnSeq: 0 } as const;

describe("isReinvocation", () => {
  it("engine-minted: an empty state id is a first turn, any id is a resume", () => {
    expect(isReinvocation("engine-minted", INPUT)).toBe(false);
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42" })).toBe(true);
  });

  it("engine-minted: turnSeq is NOT the signal (a pure-reconcile turn does not advance it; the legacy wire shape yields 0)", () => {
    expect(isReinvocation("engine-minted", { ...INPUT, turnSeq: 3 })).toBe(false);
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42", turnSeq: 0 })).toBe(true);
  });

  it("deterministic: refuses rather than guess until the native adapter lands (S3)", () => {
    expect(() => isReinvocation("deterministic", { ...INPUT, threadId: "thread-1" })).toThrow(
      /deterministic arm lands with the native adapter \(S3\)/,
    );
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

  it("any REJECT among the adjudicated decisions fails the turn, whatever else was decided", () => {
    const decisions = new Map([
      ["tc-1", ApprovalAction.APPROVE],
      ["tc-2", ApprovalAction.REJECT],
    ]);
    expect(decideReinvocation(facts({ approvalDecisions: decisions }))).toEqual({ kind: "rejected-by-user" });
  });

  it("approvals without a reject run the agent, even when file review was also reconciled", () => {
    const decisions = new Map([["tc-1", ApprovalAction.APPROVE]]);
    expect(decideReinvocation(facts({ approvalDecisions: decisions, reconciledFileReview: true }))).toBeUndefined();
    expect(
      decideReinvocation(facts({ approvalDecisions: new Map([["tc-1", ApprovalAction.SKIP]]) })),
      "a SKIP is not a reject",
    ).toBeUndefined();
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
