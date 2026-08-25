/**
 * The TS-server half of the cross-edition sequence corpus
 * (apis/testdata/hitl/sequences) — ports sequence_corpus_test.go. Where
 * the scenario corpus locks a single input → pending_approvals
 * projection, this replays the stateful, persisted-append path: each
 * sequence is a series of write sites over a carried-forward
 * approval_event_stream, and after EVERY step (1) the seam result equals
 * expected.pending_approvals, (2) for a live execution the two
 * projections agree (the equality-at-every-write-site property the
 * source-of-truth flip rides on), and (3) the authored lifecycle matches
 * expected.stream_events. The divergence counter must not move across a
 * well-formed sequence.
 */
import path from "node:path";

import { create, enumFromJson, enumToJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  ApprovalEvent,
  ApprovalEventStream,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ApprovalActionSchema,
  ApprovalEventType,
  ApprovalEventTypeSchema,
  ApprovalRetractionReasonSchema,
  ExecutionPhase,
  ExecutionPhaseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import { createLogger } from "../../../../boot/logger.js";
import { ensureApprovalRequests, recordDecisionEvent } from "../author.js";
import { computePendingApprovals, isTerminalExecution } from "../compute.js";
import { computePendingApprovalsFromEvents } from "../compute-from-events.js";
import { isGatedToolCall } from "../emit.js";
import {
  pendingApprovalDivergenceCount,
  projectPendingApprovals,
} from "../project.js";
import {
  corpusFiles,
  decodeMessages,
  decodePendingApprovals,
  decodeSubAgents,
  diffPendingApprovals,
  readCorpusJson,
} from "./corpus-support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

interface SequenceFile {
  name: string;
  execution_id: string;
  steps: SequenceStep[];
}

interface SequenceStep {
  name: string;
  status: {
    phase?: string;
    messages?: unknown[];
    sub_agent_executions?: unknown[];
  };
  decisions?: SequenceDecision[];
  expected: {
    pending_approvals?: unknown[];
    stream_events?: StreamEventView[];
  };
}

interface SequenceDecision {
  tool_call_id: string;
  action: string;
  decided_by: string;
  comment: string;
  decided_at: string;
}

/**
 * The normalized cross-edition event view: transition type, correlation
 * id, and (for a retraction) its reason — deliberately NOT the internal
 * event_id/timestamp/actor (locked by per-edition unit tests).
 */
interface StreamEventView {
  approval_request_id: string;
  event_type: string;
  reason?: string;
}

function parsePhase(s: string | undefined): ExecutionPhase {
  if (s === undefined || s === "") {
    return ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  }
  return enumFromJson(ExecutionPhaseSchema, s);
}

function parseAction(s: string): ApprovalAction {
  return enumFromJson(ApprovalActionSchema, s);
}

function findToolCall(
  status: AgentExecutionStatus,
  id: string,
): ToolCall | undefined {
  for (const msg of status.messages) {
    for (const tc of msg.toolCalls) {
      if (tc.id === id) {
        return tc;
      }
    }
  }
  for (const sa of status.subAgentExecutions) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        if (tc.id === id) {
          return tc;
        }
      }
    }
  }
  return undefined;
}

function normalizeStreamEvent(ev: ApprovalEvent): string {
  const type = enumToJson(ApprovalEventTypeSchema, ev.eventType) as string;
  let reason = "";
  if (
    ev.eventType === ApprovalEventType.RETRACTED &&
    ev.payload.case === "retracted"
  ) {
    reason = enumToJson(
      ApprovalRetractionReasonSchema,
      ev.payload.value.reason,
    ) as string;
  }
  return `${ev.approvalRequestId}|${type}|${reason}`;
}

/** Order-independent multiset diff of normalized stream-event views. */
function diffStreamEvents(
  want: StreamEventView[],
  stream: ApprovalEventStream | undefined,
): string {
  const wantCounts = new Map<string, number>();
  for (const e of want) {
    const key = `${e.approval_request_id}|${e.event_type}|${e.reason ?? ""}`;
    wantCounts.set(key, (wantCounts.get(key) ?? 0) + 1);
  }
  const gotCounts = new Map<string, number>();
  for (const ev of stream?.events ?? []) {
    const key = normalizeStreamEvent(ev);
    gotCounts.set(key, (gotCounts.get(key) ?? 0) + 1);
  }

  const diffs: string[] = [];
  for (const [key, n] of gotCounts) {
    if ((wantCounts.get(key) ?? 0) !== n) {
      diffs.push(`unexpected:${key}`);
    }
  }
  for (const [key, n] of wantCounts) {
    if ((gotCounts.get(key) ?? 0) !== n) {
      diffs.push(`missing:${key}`);
    }
  }
  diffs.sort();
  return diffs.join(",");
}

describe("shared HITL sequence corpus", () => {
  const files = corpusFiles("sequences");

  // Guard the guard: a silently empty corpus would pass for the wrong
  // reason (Go asserts >= 6 too).
  it("discovers the corpus", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    it(path.basename(file), () => {
      const seq = readCorpusJson(file) as unknown as SequenceFile;
      expect(seq.steps.length).toBeGreaterThan(0);

      // The carried-forward stream is the only state threaded across
      // steps — exactly what production persists.
      let stream: ApprovalEventStream | undefined;

      const divergenceBefore = pendingApprovalDivergenceCount();

      for (const step of seq.steps) {
        const messages = decodeMessages(step.status.messages as never);
        const subAgents = decodeSubAgents(
          step.status.sub_agent_executions as never,
        );
        const phase = parsePhase(step.status.phase);

        const status = create(AgentExecutionStatusSchema, {
          phase,
          messages,
          subAgentExecutions: subAgents,
        });
        if (stream !== undefined) {
          status.approvalEventStream = stream;
        }

        // Reproduce the production authoring for the step's write-site
        // type. A decision target must be pre-decision gated, or the
        // corpus would model a state the handler never produces.
        for (const d of step.decisions ?? []) {
          const tc = findToolCall(status, d.tool_call_id);
          expect(tc, `decision target ${d.tool_call_id} in status`).toBeDefined();
          expect(
            isGatedToolCall(tc as ToolCall) &&
              (tc as ToolCall).approvalAction === ApprovalAction.UNSPECIFIED,
            `decision target ${d.tool_call_id} pre-decision gated`,
          ).toBe(true);
        }

        ensureApprovalRequests(status, seq.execution_id);

        for (const d of step.decisions ?? []) {
          const tc = findToolCall(status, d.tool_call_id) as ToolCall;
          tc.approvalAction = parseAction(d.action);
          tc.approvalDecidedAt = d.decided_at;
          tc.approvedBy = d.decided_by;
          recordDecisionEvent(status, tc, d.decided_by, d.comment);
        }

        stream = status.approvalEventStream;

        // (1) Value contract: the real seam, as production calls it.
        const got = projectPendingApprovals(
          phase,
          messages,
          subAgents,
          stream,
          silentLogger,
        );
        const want = decodePendingApprovals(
          step.expected.pending_approvals as never,
        );
        expect(
          diffPendingApprovals(want, got),
          `step ${step.name}: seam pending_approvals`,
        ).toBe("");

        // (2) Equality-at-every-write-site for live executions.
        if (!isTerminalExecution(phase)) {
          const fromScan = computePendingApprovals(messages, subAgents);
          const fromEvents = computePendingApprovalsFromEvents(stream);
          expect(
            diffPendingApprovals(fromScan, fromEvents),
            `step ${step.name}: equality-at-write-site`,
          ).toBe("");
        }

        // (3) Lifecycle: the authored stream's normalized event view.
        expect(
          diffStreamEvents(step.expected.stream_events ?? [], stream),
          `step ${step.name}: stream_events`,
        ).toBe("");
      }

      expect(
        pendingApprovalDivergenceCount(),
        "divergence counter must not move across a well-formed sequence",
      ).toBe(divergenceBefore);
    });
  }
});
