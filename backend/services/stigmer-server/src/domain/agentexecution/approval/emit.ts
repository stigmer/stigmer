/**
 * Approval-event construction + the shadow seed — ports approval/emit.go.
 *
 * emitApprovalEvents derives a complete append-only approval-event stream
 * from the same authoritative tool-call state the message scan reads. It
 * is the SEED for the persisted stream: ensureApprovalRequests
 * (author.ts) calls it once when an execution's stream is empty, so a new
 * execution starts with its REQUESTED events and an execution that
 * predates the persisted field gets a consistent ledger (REQUESTED plus
 * the coarse decisions already on the scan) without spurious
 * projection-divergence warnings. The decisions it derives are coarse
 * (no decided_by/comment); the rich decision is authored separately by
 * recordDecisionEvent and wins via append-if-absent.
 *
 * Event ids are PERSISTED and must be byte-identical to Go's
 * `requestID + ":" + eventType.String()` — Go's String() renders the
 * FULL proto enum value name (e.g. "APPROVAL_EVENT_TYPE_REQUESTED"),
 * which protobuf-es exposes via enumToJson, NOT via the prefix-stripped
 * TS member name.
 */
import { create, enumToJson } from "@bufbuild/protobuf";

import type {
  ApprovalEvent,
  ApprovalEventStream,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalEventSchema,
  ApprovalEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ApprovalEventType,
  ApprovalEventTypeSchema,
  ApprovalRetractionReason,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

import { isTerminalSubAgent } from "./compute.js";

/**
 * Actors for approval events. REQUESTED is raised by the platform when a
 * gated tool call appears; decisions are attributed to the user.
 */
export const ACTOR_SYSTEM = "system";
export const ACTOR_USER = "user";

export function emitApprovalEvents(
  messages: AgentMessage[],
  subAgentExecutions: SubAgentExecution[],
): ApprovalEventStream {
  const stream = create(ApprovalEventStreamSchema);

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      appendToolCallEvents(stream, tc, false, "", "");
    }
  }

  for (const sa of subAgentExecutions) {
    // Mirror the message scan: a terminal sub-agent's WAITING_APPROVAL
    // tool calls are orphans and must not produce events either.
    if (isTerminalSubAgent(sa.status)) {
      continue;
    }
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        appendToolCallEvents(stream, tc, true, sa.name, sa.subject);
      }
    }
  }

  return stream;
}

function appendToolCallEvents(
  stream: ApprovalEventStream,
  tc: ToolCall,
  fromSubAgent: boolean,
  subAgentName: string,
  subAgentSubject: string,
): void {
  // Only tool calls that actually entered the approval gate produce
  // events — a call that never required approval is invisible to the
  // stream, exactly as it is to the message scan.
  if (!isGatedToolCall(tc)) {
    return;
  }

  stream.events.push(
    buildRequestedEvent(tc, fromSubAgent, subAgentName, subAgentSubject),
  );

  // The shadow seed carries a coarse decision (no decided_by/comment);
  // the authoritative rich decision is authored by SubmitApproval via
  // recordDecisionEvent (author.ts). Append-if-absent by event_id
  // guarantees the rich one, written in the same op that records the
  // decision, always wins.
  const decided = buildDecisionEvent(tc, "", "");
  if (decided !== undefined) {
    stream.events.push(decided);
  }
}

/**
 * Whether a tool call has entered the approval gate — the single
 * condition under which it produces approval events. The exact gate the
 * message scan uses (compute.ts projectToolCall), minus the decision
 * check: a gated call produces a REQUESTED event whether or not a
 * decision has since been recorded.
 */
export function isGatedToolCall(tc: ToolCall): boolean {
  return (
    tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL &&
    tc.requiresApproval
  );
}

/**
 * The REQUESTED event for a gated tool call. Callers must have confirmed
 * isGatedToolCall(tc).
 *
 * approval_request_id equals the harness tool_call_id by a deliberate,
 * documented decision (the "approval-request-id-equals-tool-call-id" HITL
 * design decision): tool_call_id is already a stable, run-unique
 * correlation key, so a separately minted id would be parallel state with
 * no reader. It is never a content hash. The ApprovalRequest payload
 * carries the same display fields as PendingApproval so the event-stream
 * projection reconstructs the identical PendingApproval the message scan
 * does, without joining back to the ToolCall.
 */
export function buildRequestedEvent(
  tc: ToolCall,
  fromSubAgent: boolean,
  subAgentName: string,
  subAgentSubject: string,
): ApprovalEvent {
  const requestId = tc.id;
  return create(ApprovalEventSchema, {
    eventId: eventId(requestId, ApprovalEventType.REQUESTED),
    approvalRequestId: requestId,
    eventType: ApprovalEventType.REQUESTED,
    timestamp: tc.approvalRequestedAt,
    actor: ACTOR_SYSTEM,
    payload: {
      case: "requested",
      value: {
        approvalRequestId: requestId,
        toolCallId: tc.id,
        requestedAt: tc.approvalRequestedAt,
        toolName: tc.name,
        message: tc.approvalMessage,
        argsPreview: tc.argsPreview,
        fromSubAgent,
        subAgentName,
        subAgentSubject,
        mcpServerSlug: tc.mcpServerSlug,
        toolKind: tc.toolKind,
        // Carried so the authoritative event-stream projection
        // reconstructs the same PendingApproval the message-scan
        // cross-check does — keeps fromEvents == fromScan.
        approvalPolicySource: tc.approvalPolicySource,
      },
    },
  });
}

/**
 * The decision event for a tool call carrying an approval_action, or
 * undefined when no decision has been recorded.
 *
 * decidedBy and comment are the audit metadata the flat ToolCall fields
 * cannot hold; the shadow seed passes them empty, while SubmitApproval
 * passes the real decider and the user's comment (author.ts). The coarse
 * event_type buckets APPROVE_ALL as APPROVED; the precise action survives
 * on the payload's ApprovalDecision.action.
 */
export function buildDecisionEvent(
  tc: ToolCall,
  decidedBy: string,
  comment: string,
): ApprovalEvent | undefined {
  const action = tc.approvalAction;
  if (action === ApprovalAction.UNSPECIFIED) {
    return undefined;
  }

  const requestId = tc.id;
  const eventType = decisionEventType(action);
  return create(ApprovalEventSchema, {
    eventId: eventId(requestId, eventType),
    approvalRequestId: requestId,
    eventType,
    timestamp: tc.approvalDecidedAt,
    actor: ACTOR_USER,
    payload: {
      case: "decided",
      value: {
        approvalRequestId: requestId,
        action,
        decidedAt: tc.approvalDecidedAt,
        decidedBy,
        comment,
      },
    },
  });
}

/**
 * The terminal RETRACTED event for an in-flight orphaned request (see
 * reconcileRetractions, author.ts). Reconciler-authored, not derived from
 * a tool-call field, so it carries no source timestamp: retracted_at is
 * left empty and ordering is conveyed by the event's position after its
 * REQUESTED in the append-only stream. An empty timestamp is also what
 * keeps the event byte-for-byte identical across editions for the shared
 * HITL corpus — a clock would diverge them. The deterministic event_id
 * (request_id:RETRACTED) makes authoring idempotent.
 */
export function buildRetractionEvent(
  requestId: string,
  reason: ApprovalRetractionReason,
): ApprovalEvent {
  return create(ApprovalEventSchema, {
    eventId: eventId(requestId, ApprovalEventType.RETRACTED),
    approvalRequestId: requestId,
    eventType: ApprovalEventType.RETRACTED,
    actor: ACTOR_SYSTEM,
    payload: {
      case: "retracted",
      value: {
        approvalRequestId: requestId,
        reason,
      },
    },
  });
}

/**
 * Maps a precise ApprovalAction to the coarse lifecycle bucket carried on
 * ApprovalEvent.event_type; APPROVE_ALL buckets as APPROVED (the precise
 * action survives on ApprovalDecision.action).
 */
export function decisionEventType(action: ApprovalAction): ApprovalEventType {
  switch (action) {
    case ApprovalAction.APPROVE:
    case ApprovalAction.APPROVE_ALL:
      return ApprovalEventType.APPROVED;
    case ApprovalAction.SKIP:
      return ApprovalEventType.SKIPPED;
    case ApprovalAction.REJECT:
      return ApprovalEventType.REJECTED;
    default:
      return ApprovalEventType.UNSPECIFIED;
  }
}

/**
 * Deterministic event id from (request_id, type) — the permanent
 * idempotency anchor for append-only authoring: a single approval has at
 * most one event per type, so (request_id, type) is unique and
 * re-authoring never duplicates an event. The type renders as the FULL
 * proto enum value name, byte-identical to Go's eventType.String().
 */
export function eventId(
  requestId: string,
  eventType: ApprovalEventType,
): string {
  return `${requestId}:${enumToJson(ApprovalEventTypeSchema, eventType) as string}`;
}
