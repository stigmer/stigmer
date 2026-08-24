/**
 * The pending-approvals projection SEAM — ports approval/project.go.
 *
 * projectPendingApprovals is the single entry point every caller uses to
 * recompute pending_approvals: the persisted approval-event stream is the
 * source of truth, and the same call runs the message scan as a
 * cross-check and asserts the two agree.
 *
 * It is a PURE read — it never mutates the stream. Authoring is the job
 * of the ensureApprovalRequests / recordDecisionEvent commands
 * (author.ts), which callers run before this projection so the passed
 * stream is current. That author-then-project ordering is the seam's
 * contract.
 *
 * "Pending" is execution-phase-aware: a terminal execution has no
 * actionable approvals (the workflow that would resume a gated call is
 * gone), so the seam returns empty for a terminal phase — both
 * projections collapse identically.
 *
 * The retained message scan is a cross-check, not the result: on any
 * disagreement it bumps the process-lifetime divergence counter and emits
 * the structured warning monitoring alerts on, without ever altering the
 * returned value.
 */
import { equals } from "@bufbuild/protobuf";

import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  ApprovalEventStream,
  PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

import type { Logger } from "../../../boot/logger.js";
import { computePendingApprovals, isTerminalExecution } from "./compute.js";
import { computePendingApprovalsFromEvents } from "./compute-from-events.js";

/**
 * Process-lifetime count of seam divergences — times the authoritative
 * event-stream projection disagreed with the legacy message scan. The OSS
 * regression backstop: a monotonic counter that must stay zero, readable
 * by tests. It NEVER gates runtime — the seam always returns the
 * event-stream result; a non-zero value is a bug to investigate, not a
 * fallback that kicks in.
 */
let pendingApprovalDivergence = 0;

/** The divergence total; reading it has no side effects. */
export function pendingApprovalDivergenceCount(): number {
  return pendingApprovalDivergence;
}

export function projectPendingApprovals(
  phase: ExecutionPhase,
  messages: AgentMessage[],
  subAgentExecutions: SubAgentExecution[],
  stream: ApprovalEventStream | undefined,
  logger: Logger,
): PendingApproval[] {
  if (isTerminalExecution(phase)) {
    return [];
  }

  const fromEvents = computePendingApprovalsFromEvents(stream);
  const fromScan = computePendingApprovals(messages, subAgentExecutions);

  const diff = diffPendingApprovals(fromScan, fromEvents);
  if (diff !== "") {
    // Bump the monotonic regression counter, then emit the structured
    // signal monitoring alerts on. Behavior is never gated on either
    // projection — fromEvents (the source of truth) is always returned.
    pendingApprovalDivergence += 1;
    logger.warn(
      "pending_approvals event-stream source of truth diverged from the message-scan cross-check",
      {
        signal: "hitl_pending_approvals_projection_divergence",
        scanCount: fromScan.length,
        eventsCount: fromEvents.length,
        divergenceTotal: pendingApprovalDivergence,
        diff,
      },
    );
  }

  return fromEvents;
}

/**
 * Compares two pending-approval sets order-independently by tool_call_id
 * and returns a short, stable description of the differences, or "" when
 * they are semantically equal. Used only to populate the divergence
 * warning; never affects the projection result.
 */
function diffPendingApprovals(
  scan: PendingApproval[],
  events: PendingApproval[],
): string {
  const scanById = indexByToolCallId(scan);
  const eventsById = indexByToolCallId(events);

  // A collision means a set carried the same tool_call_id twice — itself
  // a divergence-worthy bug, since pending approvals are a set keyed by
  // call id.
  if (scanById.size !== scan.length || eventsById.size !== events.length) {
    return "duplicate tool_call_id within a projection set";
  }

  const diffs: string[] = [];
  for (const [id, pa] of scanById) {
    const other = eventsById.get(id);
    if (other === undefined) {
      diffs.push(`only-in-scan:${id}`);
      continue;
    }
    if (!equals(PendingApprovalSchema, pa, other)) {
      diffs.push(`field-mismatch:${id}`);
    }
  }
  for (const id of eventsById.keys()) {
    if (!scanById.has(id)) {
      diffs.push(`only-in-events:${id}`);
    }
  }

  diffs.sort();
  return diffs.join(",");
}

function indexByToolCallId(
  list: PendingApproval[],
): Map<string, PendingApproval> {
  const m = new Map<string, PendingApproval>();
  for (const pa of list) {
    m.set(pa.toolCallId, pa);
  }
  return m;
}
