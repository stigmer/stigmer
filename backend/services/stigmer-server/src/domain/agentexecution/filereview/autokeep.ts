/**
 * The approved-command auto-keep policy (DD-28) — ports
 * filereview/autokeep.go.
 *
 * A turn whose ONLY mutation source was shell commands the human
 * explicitly authorized (per-command approval, APPROVE_ALL category
 * lease, or the pre-armed spec.auto_approve_all) must not re-gate its
 * file effects at the turn-boundary review — the user consented to the
 * command, and the command's file effects are the consented outcome. One
 * consent, one gate.
 *
 * TRUST MODEL. The runner asserts the turn FACTS on the candidate event
 * (TurnCommandProvenance) — the same trust level as the captured bytes.
 * The CONSENT is verified HERE against records only the server writes:
 * every cited row's approval_action was authored by SubmitApproval (and
 * is preserved against runner writes), and the auto_approve_all flag is
 * checked against the spec. A runner can therefore never mint
 * authorization it was never given.
 *
 * The decision is a REAL FILE_DECIDED event (origin
 * POLICY_APPROVED_COMMAND, actor "policy", digest-bound to the reviewed
 * aggregate) — not a projection shortcut — so the fold keeps one
 * semantics, the audit trail shows who decided, and the runner reconciles
 * it exactly like a human keep-all.
 */
import { create } from "@bufbuild/protobuf";

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  FileChangeSet,
  FileDecision,
  TurnCommandProvenance,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileDecisionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import type { Logger } from "../../../boot/logger.js";
import {
  ACTOR_POLICY,
  approveBlockedReason,
  decisionScopeId,
  findChangeSet,
  recordFileDecisionEventWithActor,
} from "./author.js";
import { projectFileChangeSets } from "./project.js";

/**
 * The audit-trail text on a policy decision. The UI label derives from
 * FileDecision.origin; this is for the record itself.
 */
const AUTO_KEEP_REASON =
  "Kept automatically: every change in this turn was produced by a command the user approved";

/**
 * Evaluates every undecided AWAITING_REVIEW change set whose candidate
 * carries TurnCommandProvenance and — when the consent verifies and the
 * set is fully reviewable — authors the policy APPROVE. Returns how many
 * sets were auto-kept.
 *
 * Idempotent: the deterministic decision/event id makes re-evaluation on
 * every status write a no-op once decided, and a racing human decision
 * wins by first-append. Fail-closed: any verification miss leaves the set
 * awaiting manual review, exactly as if no provenance existed.
 *
 * Must run inside the store write lock (with appendRunnerEvents, before
 * the projection) so the authored decision lands in the same write as the
 * candidate that qualified it — the workflow's gate check then never sees
 * a transient AWAITING_REVIEW for an auto-kept set.
 */
export function autoKeepApprovedCommandSets(
  status: AgentExecutionStatus,
  executionId: string,
  autoApproveAll: boolean,
  logger: Logger,
): number {
  const stream = status.fileReviewEventStream;
  if (stream === undefined || stream.events.length === 0) {
    return 0;
  }
  const changeSets = projectFileChangeSets(status.phase, stream);
  if (changeSets.length === 0) {
    return 0;
  }

  let kept = 0;
  for (const ev of stream.events) {
    if (ev.eventType !== FileReviewEventType.CANDIDATE_CAPTURED) {
      continue;
    }
    const provenance =
      ev.payload.case === "candidateCaptured"
        ? ev.payload.value.commandProvenance
        : undefined;
    if (provenance === undefined) {
      continue;
    }
    const cs = findChangeSet(changeSets, ev.changeSetId);
    if (
      cs === undefined ||
      cs.status !== FileChangeSetStatus.AWAITING_REVIEW
    ) {
      continue;
    }
    if (cs.decisions.length > 0) {
      // A (possibly partial) human decision exists — the human owns this
      // set.
      continue;
    }
    // The same fail-closed completeness gate a human APPROVE passes, with
    // NO binary acknowledgment: an unreviewable or binary-blocked set is
    // never auto-kept — it falls back to manual review.
    const blockedReason = approveBlockedReason(
      cs,
      FileDecisionScope.CHANGE_SET,
      "",
      false,
    );
    if (blockedReason !== "") {
      logger.info("Auto-keep skipped: set not fully reviewable — manual review", {
        executionId,
        changeSetId: cs.id,
        blockedReason,
      });
      continue;
    }
    if (!verifyCommandConsent(status, provenance, autoApproveAll)) {
      logger.warn(
        "Auto-keep skipped: claimed consent did not verify against server-authored approvals — manual review",
        {
          executionId,
          changeSetId: cs.id,
          consentToolCallIds: provenance.consentToolCallIds,
        },
      );
      continue;
    }

    const decision = buildPolicyAutoKeepDecision(cs);
    recordFileDecisionEventWithActor(
      status,
      executionId,
      decision,
      ACTOR_POLICY,
    );
    kept++;
    logger.info(
      "Auto-kept change set: every change produced by an approved command (DD-28)",
      {
        executionId,
        changeSetId: cs.id,
        consentToolCallIds: provenance.consentToolCallIds,
        authorizedByAutoApproveAll: provenance.authorizedByAutoApproveAll,
      },
    );
  }
  return kept;
}

/**
 * The policy twin of buildFileDecision: a CHANGE_SET-scoped APPROVE bound
 * to the aggregate digest the runner captured, origin
 * POLICY_APPROVED_COMMAND, no reviewer (the actor is "policy"). Shares
 * the deterministic id space, so a concurrent human decision on the same
 * set collapses to whichever was appended first.
 */
function buildPolicyAutoKeepDecision(cs: FileChangeSet): FileDecision {
  const decision = create(FileDecisionSchema, {
    changeSetId: cs.id,
    scope: FileDecisionScope.CHANGE_SET,
    action: FileDecisionAction.APPROVE,
    expectedDigest: cs.aggregateDigest,
    decidedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    reason: AUTO_KEEP_REASON,
    origin: FileDecisionOrigin.POLICY_APPROVED_COMMAND,
  });
  decision.id = `${cs.id}:${decisionScopeId(decision)}`;
  return decision;
}

/**
 * Checks the runner's consent claims against the records only the server
 * writes. Every cited tool call must exist and carry a
 * SubmitApproval-authored APPROVE or APPROVE_ALL; the auto_approve_all
 * claim must match the spec-owned flag. At least one consent source is
 * required — an empty claim authorizes nothing.
 */
function verifyCommandConsent(
  status: AgentExecutionStatus,
  provenance: TurnCommandProvenance,
  autoApproveAll: boolean,
): boolean {
  if (provenance.authorizedByAutoApproveAll && !autoApproveAll) {
    return false;
  }
  const ids = provenance.consentToolCallIds;
  if (ids.length === 0 && !provenance.authorizedByAutoApproveAll) {
    return false;
  }
  for (const id of ids) {
    const tc = findToolCall(status, id);
    if (tc === undefined) {
      return false;
    }
    switch (tc.approvalAction) {
      case ApprovalAction.APPROVE:
      case ApprovalAction.APPROVE_ALL:
        // Server-authored consent — verified.
        break;
      default:
        return false;
    }
  }
  return true;
}

/**
 * Locates a tool call by id across the transcript and sub-agent
 * transcripts (a lease-granting APPROVE_ALL row may live in either).
 */
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
