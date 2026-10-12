/**
 * The approved-command auto-keep policy — ports
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
 *
 * Beside it, the two other policy keeps: a plugin eval's try keeps its
 * edits (autoKeepPluginEvalTrySets), and a turn's still-undecided edits
 * are kept once a later message is sent (keepOutdatedSets). Every policy
 * decision reaches the session's log as a `stigmer.file_review.decided`
 * event through the run write that records it (session/events/run-writes.ts).
 */
import { create } from "@bufbuild/protobuf";

import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  FileChangeSet,
  FileDecision,
  TurnCommandProvenance,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileDecisionSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

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
  status: RunStatus,
  executionId: string,
  autoApproveAll: boolean,
  logger: Logger,
): number {
  const stream = status.fileReviewEventStream;
  if (stream === undefined || stream.events.length === 0) {
    return 0;
  }
  const changeSets = projectFileChangeSets(stream);
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
      "Auto-kept change set: every change produced by an approved command",
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
  status: RunStatus,
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
  status: RunStatus,
  id: string,
): ToolCall | undefined {
  for (const msg of status.messages) {
    for (const tc of msg.toolCalls) {
      if (tc.id === id) {
        return tc;
      }
    }
  }
  for (const sa of status.subAgentRuns) {
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

/** The audit-trail text on a plugin-eval try's policy decision. */
const EVAL_TRY_KEEP_REASON =
  "Kept automatically: a plugin eval's try keeps its edits, as Claude Code's evals do; nobody reviews a try";

/**
 * The plugin-eval try keep: a run that is an eval's try (the reserved
 * `stigmer.ai/plugin-eval` label, which only the server can set) keeps every
 * undecided AWAITING_REVIEW change set, binary changes included, in the same
 * write that folded it, so the try's run never waits for a review nobody
 * gives. Its change sets stay on record: the eval's file graders read them.
 * A set that cannot be approved whole (an unreviewable capture) is left to
 * the try's timeout, logged. Returns how many sets were kept.
 *
 * Idempotent and first-append-wins, as the approved-command keep is.
 */
export function autoKeepPluginEvalTrySets(
  status: RunStatus,
  executionId: string,
  isEvalTry: boolean,
  logger: Logger,
): number {
  const stream = status.fileReviewEventStream;
  if (!isEvalTry || stream === undefined || stream.events.length === 0) {
    return 0;
  }
  let kept = 0;
  for (const cs of projectFileChangeSets(stream)) {
    if (cs.status !== FileChangeSetStatus.AWAITING_REVIEW || cs.decisions.length > 0) {
      continue;
    }
    const blockedReason = approveBlockedReason(cs, FileDecisionScope.CHANGE_SET, "", true);
    if (blockedReason !== "") {
      logger.warn("Eval try keep skipped: set cannot be approved whole", {
        executionId,
        changeSetId: cs.id,
        blockedReason,
      });
      continue;
    }
    const decision = create(FileDecisionSchema, {
      changeSetId: cs.id,
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest: cs.aggregateDigest,
      decidedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      reason: EVAL_TRY_KEEP_REASON,
      origin: FileDecisionOrigin.POLICY_EVAL_TRY,
      acknowledgeUnreviewable: true,
    });
    decision.id = `${cs.id}:${decisionScopeId(decision)}`;
    recordFileDecisionEventWithActor(status, executionId, decision, ACTOR_POLICY);
    kept++;
  }
  return kept;
}

/** The audit-trail text on a decision the next message made. */
const NEXT_TURN_KEEP_REASON =
  "Kept automatically: the next message was sent before these edits were decided";

/**
 * The close of a turn's file review: once a later message is sent, every
 * still-undecided file of this run's change sets is kept, origin
 * POLICY_NEXT_TURN, actor "policy". A set nobody decided gets one
 * CHANGE_SET keep; a set decided in part gets one FILE keep per file not
 * yet decided, so a person's decisions stand. A set still capturing (no
 * candidate yet) is left for the write that folds its candidate, which
 * closes it then (update-status.ts).
 *
 * No completeness gate: the files are already on disk, and keeping them
 * is what the conversation did by moving on, so an unreviewable or binary
 * file is kept as it is. Idempotent by the deterministic decision ids, and
 * first-append-wins against a person's decision, as the other keeps are.
 * Must run inside the run's write lock, before the projection. Returns how
 * many decisions it recorded.
 */
export function keepOutdatedSets(status: RunStatus, executionId: string): number {
  const stream = status.fileReviewEventStream;
  if (stream === undefined || stream.events.length === 0) {
    return 0;
  }
  const decidedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let kept = 0;
  for (const cs of projectFileChangeSets(stream)) {
    if (cs.status !== FileChangeSetStatus.AWAITING_REVIEW) {
      continue;
    }
    for (const decision of nextTurnKeeps(cs, decidedAt)) {
      recordFileDecisionEventWithActor(status, executionId, decision, ACTOR_POLICY);
      kept++;
    }
  }
  return kept;
}

/** The keeps that close one undecided or partly decided set. */
function nextTurnKeeps(cs: FileChangeSet, decidedAt: string): FileDecision[] {
  const keep = (scope: FileDecisionScope, fileChangeId: string, expectedDigest: string): FileDecision => {
    const decision = create(FileDecisionSchema, {
      changeSetId: cs.id,
      fileChangeId,
      scope,
      action: FileDecisionAction.APPROVE,
      expectedDigest,
      decidedAt,
      reason: NEXT_TURN_KEEP_REASON,
      origin: FileDecisionOrigin.POLICY_NEXT_TURN,
      acknowledgeUnreviewable: true,
    });
    decision.id = `${cs.id}:${decisionScopeId(decision)}`;
    return decision;
  };
  if (cs.decisions.length === 0) {
    return [keep(FileDecisionScope.CHANGE_SET, "", cs.aggregateDigest)];
  }
  const decided = new Set(
    cs.decisions.filter((d) => d.scope === FileDecisionScope.FILE).map((d) => d.fileChangeId),
  );
  return cs.changes
    .filter((change) => !decided.has(change.id))
    .map((change) => keep(FileDecisionScope.FILE, change.id, change.fileDigest));
}
