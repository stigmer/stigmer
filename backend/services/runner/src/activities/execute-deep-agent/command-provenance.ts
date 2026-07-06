/**
 * Approved-command turn provenance (DD-28) — the DEEP-AGENT (native) harness
 * adapter over the shared qualification rule ({@link qualifyTurnCommandProvenance}).
 *
 * The deep-agent's consent model differs from Cursor's in exactly two ways, and
 * this adapter is precisely those two differences:
 *
 * 1. IDENTITY turn scoping (not positional). Cursor scopes a turn by the message
 *    index its stream started at. The deep-agent cannot: an approved command
 *    executes IN PLACE at its seeded transcript position (it was proposed in a
 *    prior segment, seeded into this segment, and updated to COMPLETED by
 *    `StatusBuilder.findResumableSeededToolCall`). So "this turn's calls" are
 *    those whose id is absent from a pre-stream {@link collectSettledToolCallIds}
 *    snapshot, and "executed" is a COMPLETED status.
 *
 * 2. SAME-ROW direct consent (not a grant token). A gated deep-agent tool pauses
 *    on a LangGraph interrupt; SubmitApproval writes `approval_action` onto that
 *    same row, and the row keeps its id + `approval_action` when it executes on
 *    resume. So the executed command IS its own consent row — cite its own id.
 *    (The server's PreserveApprovalFields keeps that `approval_action` on the row
 *    across the status write regardless of its new status, so the backend's
 *    verification finds it.)
 *
 * A turn that delegated ANY sub-agent fails closed (DD-28 D1: "delegated zero
 * sub-agents"). A sub-agent's writes fold into the parent turn's change set
 * (DD-19) but are not attributable to a consented top-level command. The
 * top-level `task` call (a SUBAGENT kind) already trips the shared rule's
 * `!== SHELL` fail-closed; the explicit sub-agent-novelty guard below also covers
 * the (currently-impossible under the replace-per-turn model) case of a sub-agent
 * that mutates across a turn boundary without a fresh top-level `task` row.
 *
 * (Trust boundary + fail-closed contract: see the shared module.)
 */

import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { TurnCommandProvenance } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { qualifyTurnCommandProvenance } from "../../shared/filereview/command-provenance.js";
import { collectSubAgentToolCallIds } from "../../shared/tool-row.js";

export interface DeepAgentCommandProvenanceInputs {
  /** The status at capture time — top-level messages + sub-agent executions. */
  readonly status: AgentExecutionStatus;
  /**
   * The top-level tool-call ids that had already SETTLED before this turn's
   * stream (from {@link collectSettledToolCallIds}). A top-level call whose id is
   * absent is this-turn's; the shared rule then keeps only the COMPLETED ones.
   */
  readonly priorSettledToolCallIds: ReadonlySet<string>;
  /**
   * The sub-agent tool-call ids that existed before this turn's stream (from
   * {@link collectSubAgentToolCallIds}). Any growth means a sub-agent acted this
   * turn → fail closed.
   */
  readonly priorSubAgentToolCallIds: ReadonlySet<string>;
  /** True when the pre-armed spec.auto_approve_all bypassed the gate. */
  readonly globalBypass: boolean;
}

/**
 * Derive the {@link TurnCommandProvenance} for a deep-agent turn, or undefined
 * when it does not qualify. Scopes this turn's top-level calls by id-novelty,
 * resolves consent from the row's own server-authored `approval_action`, fails
 * closed on any sub-agent activity, and delegates the DD-28 rule to
 * {@link qualifyTurnCommandProvenance}.
 */
export function deriveTurnCommandProvenance(
  inputs: DeepAgentCommandProvenanceInputs,
): TurnCommandProvenance | undefined {
  const { status, priorSettledToolCallIds, priorSubAgentToolCallIds, globalBypass } = inputs;

  // DD-28 D1 cond 2: any sub-agent activity this turn disqualifies. A sub-agent
  // that ran this turn contributes at least one tool-call id absent from the
  // pre-stream snapshot.
  for (const id of collectSubAgentToolCallIds(status.subAgentExecutions)) {
    if (!priorSubAgentToolCallIds.has(id)) return undefined;
  }

  const messages = status.messages;
  // This turn's top-level calls: those not already settled before the stream.
  const turnToolCalls = messages
    .flatMap((m) => m.toolCalls)
    .filter((tc) => !priorSettledToolCallIds.has(tc.id));

  return qualifyTurnCommandProvenance({
    turnToolCalls,
    messages,
    // A deep-agent command executed iff its row reached COMPLETED this turn.
    isExecutedCommand: (tc) => tc.status === ToolCallStatus.TOOL_CALL_COMPLETED,
    // The gated command carries its own server-authored approval_action, written
    // in place by SubmitApproval and preserved when the row executes on resume.
    resolveDirectConsent: (tc) =>
      tc.approvalAction === ApprovalAction.APPROVE ||
      tc.approvalAction === ApprovalAction.APPROVE_ALL
        ? tc.id
        : undefined,
    globalBypass,
  });
}
