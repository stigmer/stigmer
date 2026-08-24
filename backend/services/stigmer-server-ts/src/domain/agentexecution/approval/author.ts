/**
 * Authors the PERSISTED approval-event stream
 * (AgentExecutionStatus.approval_event_stream) — ports approval/author.go.
 *
 * Two commands, one writer per event type:
 *   - ensureApprovalRequests authors REQUESTED events (the UpdateStatus
 *     handlers own it; it also seeds the stream once for executions that
 *     predate the field) and, on the same pass, authors RETRACTED events
 *     for in-flight orphans so the lifecycle is total.
 *   - recordDecisionEvent authors a single decision event (the
 *     SubmitApproval handler owns it, carrying decided_by + the user's
 *     comment).
 *
 * Every append is keyed by the deterministic ApprovalEvent.event_id, so
 * both commands are idempotent under retries and a rich decision event —
 * written in the same operation that records the decision on the message
 * scan — can never be duplicated or clobbered by the coarse decision the
 * seed derives. The projection seam (project.ts) stays a pure read over
 * whatever these commands have written.
 */
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ApprovalEventStream } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { create } from "@bufbuild/protobuf";
import { ApprovalEventStreamSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalEventType,
  ApprovalRetractionReason,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import {
  computePendingApprovals,
  isTerminalExecution,
  isTerminalSubAgent,
} from "./compute.js";
import { isResolvingEvent } from "./compute-from-events.js";
import {
  buildDecisionEvent,
  buildRequestedEvent,
  buildRetractionEvent,
  emitApprovalEvents,
  isGatedToolCall,
} from "./emit.js";

/**
 * Records a REQUESTED event for every tool call currently in the approval
 * gate, mutating status.approval_event_stream in place. The sole writer
 * of REQUESTED events; called at every UpdateStatus site and at the start
 * of the SubmitApproval transaction (before the decision is recorded, so
 * a request always precedes its decision).
 *
 * When the stream is empty it is seeded once from the authoritative
 * message scan (emitApprovalEvents): for a new execution that is just the
 * REQUESTED events; for an execution predating the field it is REQUESTED
 * plus the coarse decisions already recorded on the scan, so the ledger
 * is consistent from first touch without spurious projection-divergence
 * warnings. Thereafter only REQUESTED events are appended (decisions are
 * authored by recordDecisionEvent), keeping the parity check a real
 * cross-writer guard rather than a tautology.
 *
 * executionId stamps the stream's identity on first seed; informational,
 * never used for correlation. Correlation is by approval_request_id,
 * which equals tool_call_id by a deliberate, documented decision.
 */
export function ensureApprovalRequests(
  status: AgentExecutionStatus | undefined,
  executionId: string,
): void {
  if (status === undefined) {
    return;
  }

  const stream = status.approvalEventStream;
  if (stream === undefined || stream.events.length === 0) {
    const seeded = emitApprovalEvents(
      status.messages,
      status.subAgentExecutions,
    );
    seeded.executionId = executionId;
    status.approvalEventStream = seeded;
    return;
  }

  const seen = eventIdSet(stream);
  appendRequestedIfAbsent(stream, seen, status.messages, false, "", "");
  for (const sa of status.subAgentExecutions) {
    // Mirror the scan and the seed: a terminal sub-agent's gated tool
    // calls are orphans and must not surface, so never author requests
    // for them.
    if (isTerminalSubAgent(sa.status)) {
      continue;
    }
    appendRequestedIfAbsent(stream, seen, sa.messages, true, sa.name, sa.subject);
  }

  reconcileRetractions(status, stream, seen);
}

/**
 * Completes the approval lifecycle by authoring a RETRACTED event for
 * every in-flight per-call orphan: a REQUESTED whose gated call has left
 * the gate WITHOUT a user decision while the execution is still live (its
 * sub-agent reached a terminal state, or the harness superseded the call
 * on resume). Without this, the append-only stream would keep the orphan
 * REQUESTED forever and the event-stream projection would report a
 * phantom pending approval the message scan already dropped.
 *
 * It is the mirror image of the message scan's two non-decision exits;
 * two invariants keep it from ever OVER-retracting (which would crash a
 * parked execution to FAILED via the WAITING ⟺ ≥1 pending fail-fast):
 *   - Terminal executions are skipped entirely — they project to empty
 *     via the phase-aware seam, so a dangling REQUESTED on a dead
 *     execution is explained by the phase, not an orphan to retract.
 *   - A call still in the gate (present in the scan) or already resolved
 *     (a decision or prior retraction exists) is never retracted. In
 *     particular, the SubmitApproval pre-decision ensure runs while the
 *     clicked and APPROVE_ALL co-pending calls are still gated, so they
 *     are never false-retracted.
 */
function reconcileRetractions(
  status: AgentExecutionStatus,
  stream: ApprovalEventStream,
  seen: Set<string>,
): void {
  if (isTerminalExecution(status.phase)) {
    return;
  }

  const gated = gatedToolCallIds(status);
  const resolved = resolvedRequestIds(stream);

  // Snapshot the events: retractions are appended below, and iterating a
  // snapshot keeps the pass from considering its own output.
  const original = [...stream.events];
  for (const ev of original) {
    if (ev.eventType !== ApprovalEventType.REQUESTED) {
      continue;
    }
    const reqId = ev.approvalRequestId;
    if (gated.has(reqId)) {
      continue;
    }
    if (resolved.has(reqId)) {
      continue;
    }
    const event = buildRetractionEvent(reqId, retractionReason(status, reqId));
    if (seen.has(event.eventId)) {
      continue;
    }
    stream.events.push(event);
    seen.add(event.eventId);
  }
}

/**
 * The set of tool_call_ids still in the approval gate per the
 * authoritative message scan — i.e. the REQUESTED events that must NOT be
 * retracted. reconcileRetractions only runs for non-terminal executions,
 * where the scan is the exact live gate set.
 */
function gatedToolCallIds(status: AgentExecutionStatus): Set<string> {
  const pending = computePendingApprovals(
    status.messages,
    status.subAgentExecutions,
  );
  return new Set(pending.map((pa) => pa.toolCallId));
}

/**
 * The set of approval_request_ids already carrying a terminal event — a
 * user decision (APPROVED/REJECTED/SKIPPED) or a prior RETRACTED — so
 * reconcileRetractions never double-resolves an approval.
 */
function resolvedRequestIds(stream: ApprovalEventStream): Set<string> {
  const resolved = new Set<string>();
  for (const ev of stream.events) {
    if (isResolvingEvent(ev.eventType)) {
      resolved.add(ev.approvalRequestId);
    }
  }
  return resolved;
}

/**
 * Classifies why an in-flight request was orphaned, for the audit trail
 * only. A call still located inside a now-terminal sub-agent was orphaned
 * by that sub-agent finishing; anything else (a root call, or a call
 * whose status advanced off WAITING_APPROVAL) was superseded.
 */
function retractionReason(
  status: AgentExecutionStatus,
  requestId: string,
): ApprovalRetractionReason {
  for (const sa of status.subAgentExecutions) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        if (tc.id === requestId) {
          if (isTerminalSubAgent(sa.status)) {
            return ApprovalRetractionReason.SUB_AGENT_TERMINAL;
          }
          return ApprovalRetractionReason.SUPERSEDED;
        }
      }
    }
  }
  return ApprovalRetractionReason.SUPERSEDED;
}

function appendRequestedIfAbsent(
  stream: ApprovalEventStream,
  seen: Set<string>,
  messages: AgentMessage[],
  fromSubAgent: boolean,
  subAgentName: string,
  subAgentSubject: string,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (!isGatedToolCall(tc)) {
        continue;
      }
      const event = buildRequestedEvent(
        tc,
        fromSubAgent,
        subAgentName,
        subAgentSubject,
      );
      if (seen.has(event.eventId)) {
        continue;
      }
      stream.events.push(event);
      seen.add(event.eventId);
    }
  }
}

/**
 * Appends the decision event for a single decided tool call, carrying
 * decided_by and the user's comment. The sole writer of decision events
 * (the SubmitApproval handler), called once for the clicked tool call
 * (with the comment) and once per co-pending tool call an APPROVE_ALL
 * bulk-approves (with an empty comment — the escalation comment belongs
 * to the clicked tool).
 *
 * A no-op when the tool call carries no decision, and append-if-absent by
 * event_id so a repeated submit or a later coarse seed never
 * double-records.
 */
export function recordDecisionEvent(
  status: AgentExecutionStatus | undefined,
  tc: ToolCall,
  decidedBy: string,
  comment: string,
): void {
  if (status === undefined) {
    return;
  }
  const event = buildDecisionEvent(tc, decidedBy, comment);
  if (event === undefined) {
    return;
  }

  let stream = status.approvalEventStream;
  if (stream === undefined) {
    stream = create(ApprovalEventStreamSchema);
    status.approvalEventStream = stream;
  }
  if (stream.events.some((ev) => ev.eventId === event.eventId)) {
    return;
  }
  stream.events.push(event);
}

/** Indexes a stream's events by event_id for append-if-absent checks. */
function eventIdSet(stream: ApprovalEventStream): Set<string> {
  return new Set(stream.events.map((ev) => ev.eventId));
}
