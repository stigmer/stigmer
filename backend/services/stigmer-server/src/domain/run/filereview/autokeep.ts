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
 * every cited call's tool use has a person's allow in the session's log
 * (a user.tool_confirmation, which confirmToolUse and grantPermission
 * write and a runner's append is refused), and the auto_approve_all flag
 * is checked against the spec. A runner can therefore never mint
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
 *
 * What is decided is the log's to say (logged.ts): each keep reads the
 * run's decisions and answers from the session's log, handed in by the
 * write it runs under (`RunReviewLog`), and the sets and their files from
 * the ledger's capture. The FILE_DECIDED it records is the ledger's mirror
 * of the decision, written beside the log's event.
 */
import { create } from "@bufbuild/protobuf";

import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
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

import type { Logger } from "../../../boot/logger.js";
import { toolUseEventId } from "../../session/events/ids.js";
import {
  ACTOR_POLICY,
  approveBlockedReason,
  decisionScopeId,
  findChangeSet,
  recordFileDecisionEventWithActor,
} from "./author.js";
import { awaitsReview, decisionsOn, undecidedFileIds } from "./logged.js";
import type { LoggedDecision, RunReviewLog } from "./logged.js";
import { projectFileChangeSets } from "./project.js";

/**
 * The audit-trail text on a policy decision. The UI label derives from
 * FileDecision.origin; this is for the record itself.
 */
const AUTO_KEEP_REASON =
  "Kept automatically: every change in this turn was produced by a command the user approved";

/**
 * Evaluates every change set no decision in the log touches whose
 * candidate carries TurnCommandProvenance and — when the consent verifies
 * and the set is fully reviewable — authors the policy APPROVE. Returns
 * how many sets were auto-kept.
 *
 * Idempotent: a set the log shows decided is passed over, and the
 * deterministic decision/event id makes a repeat a no-op. Fail-closed: any
 * verification miss leaves the set awaiting manual review, exactly as if
 * no provenance existed.
 *
 * Must run inside the store write lock (with appendRunnerEvents, before
 * the projection), with the run's log read under that lock, so the
 * authored decision lands in the same write as the candidate that
 * qualified it.
 */
export function autoKeepApprovedCommandSets(
  status: RunStatus,
  executionId: string,
  autoApproveAll: boolean,
  logger: Logger,
  log: RunReviewLog,
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
    const decisions = cs === undefined ? [] : decisionsOn(log, cs.id);
    if (cs === undefined || !awaitsReview(cs, decisions)) {
      continue;
    }
    if (decisions.length > 0) {
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
    if (!verifyCommandConsent(executionId, provenance, autoApproveAll, log)) {
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
 * writes. Every cited call's tool use (the root's or a sub-agent's: the
 * id is derived the same way, session/events/ids.ts) must have a person's
 * allow in the log — a confirmation, or the grant's own call, whose
 * confirmation is an allow too; the auto_approve_all claim must match the
 * spec-owned flag. At least one consent source is required — an empty
 * claim authorizes nothing.
 */
function verifyCommandConsent(
  executionId: string,
  provenance: TurnCommandProvenance,
  autoApproveAll: boolean,
  log: RunReviewLog,
): boolean {
  if (provenance.authorizedByAutoApproveAll && !autoApproveAll) {
    return false;
  }
  const ids = provenance.consentToolCallIds;
  if (ids.length === 0 && !provenance.authorizedByAutoApproveAll) {
    return false;
  }
  return ids.every((id) => log.allowed.has(toolUseEventId(executionId, id)));
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
  log: RunReviewLog,
): number {
  const stream = status.fileReviewEventStream;
  if (!isEvalTry || stream === undefined || stream.events.length === 0) {
    return 0;
  }
  let kept = 0;
  for (const cs of projectFileChangeSets(stream)) {
    const decisions = decisionsOn(log, cs.id);
    if (!awaitsReview(cs, decisions) || decisions.length > 0) {
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
export function keepOutdatedSets(status: RunStatus, executionId: string, log: RunReviewLog): number {
  const stream = status.fileReviewEventStream;
  if (stream === undefined || stream.events.length === 0) {
    return 0;
  }
  const decidedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let kept = 0;
  for (const cs of projectFileChangeSets(stream)) {
    const decisions = decisionsOn(log, cs.id);
    if (!awaitsReview(cs, decisions)) {
      continue;
    }
    for (const decision of nextTurnKeeps(cs, decisions, decidedAt)) {
      recordFileDecisionEventWithActor(status, executionId, decision, ACTOR_POLICY);
      kept++;
    }
  }
  return kept;
}

/** The keeps that close one undecided or partly decided set, by the log's decisions on it. */
function nextTurnKeeps(
  cs: FileChangeSet,
  decisions: ReadonlyArray<LoggedDecision>,
  decidedAt: string,
): FileDecision[] {
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
  if (decisions.length === 0) {
    return [keep(FileDecisionScope.CHANGE_SET, "", cs.aggregateDigest)];
  }
  const undecided = new Set(undecidedFileIds(cs, decisions));
  return cs.changes
    .filter((change) => undecided.has(change.id))
    .map((change) => keep(FileDecisionScope.FILE, change.id, change.fileDigest));
}
