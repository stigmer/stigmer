/**
 * The rules that keep a turn's file changes on the person's behalf.
 *
 *   approved command . a turn whose ONLY mutation source was shell
 *                      commands the person explicitly allowed (per call,
 *                      by a grant for the class, or under the pre-armed
 *                      spec.auto_approve_all) does not ask again at the
 *                      turn's review: the person consented to the command,
 *                      and its file effects are the consented outcome. One
 *                      consent, one gate.
 *   eval try ......... an eval run's try keeps its edits: nobody reviews
 *                      a try (autoKeepEvalRunTrySets).
 *   next turn ........ once a later message is sent, a turn's still
 *                      undecided edits are kept (keepOutdatedSets).
 *
 * TRUST MODEL. The runner asserts the turn's facts on the change set
 * (FileChangeSet.command_provenance), the same trust level as the captured
 * bytes. The CONSENT is verified here against records only the server
 * writes: every cited call's tool use has a person's allow in the
 * session's log (a user.tool_confirmation, which confirmToolUse and
 * grantPermission write and a runner's append is refused), and the
 * auto_approve_all claim is checked against the spec. A runner can
 * therefore never mint authorization it was never given.
 *
 * What is decided is the log's to say (logged.ts), and which sets and
 * files a run has is its file record (record.ts). Each rule reads both and
 * returns the `stigmer.file_review.decided` events it decides
 * (decided.ts, a rule's origin and no decider); the write it runs in
 * appends them. Idempotent: a set the log shows decided is passed over,
 * and the event id is the target's, so a repeat appends nothing.
 */
import type { FileChangeSet, TurnCommandProvenance } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import type { Logger } from "../../../boot/logger.js";
import { toolUseEventId } from "../../session/events/ids.js";
import { decidedEvent } from "./decided.js";
import { awaitsReview, decisionsOn, undecidedFileIds } from "./logged.js";
import type { LoggedDecision, RunReviewLog } from "./logged.js";
import { keepBlockedReason } from "./record.js";

/** The reason on an approved-command keep. */
const AUTO_KEEP_REASON =
  "Kept automatically: every change in this turn was produced by a command the user approved";

/**
 * The approved-command keep: every set no decision in the log touches
 * whose provenance is present, verifies, and whose diff can be shown
 * whole is kept, change-set wide, bound to the aggregate digest.
 * Fail-closed: any miss leaves the set for a person, as if no provenance
 * existed.
 */
export function autoKeepApprovedCommandSets(
  sets: ReadonlyArray<FileChangeSet>,
  runId: string,
  autoApproveAll: boolean,
  logger: Logger,
  log: RunReviewLog,
): SessionEvent[] {
  const kept: SessionEvent[] = [];
  for (const cs of sets) {
    const provenance = cs.commandProvenance;
    if (provenance === undefined) {
      continue;
    }
    const decisions = decisionsOn(log, cs.id);
    // A (possibly partial) decision exists: the person owns this set.
    if (!awaitsReview(cs, decisions) || decisions.length > 0) {
      continue;
    }
    // The same fail-closed completeness gate a person's keep passes, with
    // NO binary acknowledgment: a set that cannot be shown whole waits for
    // a person.
    const blockedReason = keepBlockedReason(cs, "change_set", "", false);
    if (blockedReason !== "") {
      logger.info("Auto-keep skipped: set not fully reviewable — manual review", {
        executionId: runId,
        changeSetId: cs.id,
        blockedReason,
      });
      continue;
    }
    if (!verifyCommandConsent(runId, provenance, autoApproveAll, log)) {
      logger.warn(
        "Auto-keep skipped: claimed consent did not verify against server-authored approvals — manual review",
        {
          executionId: runId,
          changeSetId: cs.id,
          consentToolCallIds: provenance.consentToolCallIds,
        },
      );
      continue;
    }
    kept.push(setKeep(runId, cs, "approved_command", AUTO_KEEP_REASON));
    logger.info("Auto-kept change set: every change produced by an approved command", {
      executionId: runId,
      changeSetId: cs.id,
      consentToolCallIds: provenance.consentToolCallIds,
      authorizedByAutoApproveAll: provenance.authorizedByAutoApproveAll,
    });
  }
  return kept;
}

/**
 * Checks the runner's consent claims against the records only the server
 * writes. Every cited call's tool use (the root's or a sub-agent's: the
 * id is derived the same way, session/events/ids.ts) must have a person's
 * allow in the log; the auto_approve_all claim must match the spec-owned
 * flag. At least one consent source is required: an empty claim
 * authorizes nothing.
 */
function verifyCommandConsent(
  runId: string,
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
  return ids.every((id) => log.allowed.has(toolUseEventId(runId, id)));
}

/** The reason on a eval-run try's keep. */
const EVAL_TRY_KEEP_REASON =
  "Kept automatically: an eval run's try keeps its edits, as Claude Code's evals do; nobody reviews a try";

/**
 * The eval-run try keep: a run that is an eval's try (the reserved
 * `stigmer.ai/eval-run` label, which only the server can set) keeps
 * every undecided set, binary changes included, in the write that captured
 * it, so the try never waits for a review nobody gives. Its sets stay on
 * the record: the eval's file graders read them. A set that cannot be
 * kept whole (an unreviewable capture) is left to the try's timeout,
 * logged.
 */
export function autoKeepEvalRunTrySets(
  sets: ReadonlyArray<FileChangeSet>,
  runId: string,
  isEvalTry: boolean,
  logger: Logger,
  log: RunReviewLog,
): SessionEvent[] {
  if (!isEvalTry) {
    return [];
  }
  const kept: SessionEvent[] = [];
  for (const cs of sets) {
    const decisions = decisionsOn(log, cs.id);
    if (!awaitsReview(cs, decisions) || decisions.length > 0) {
      continue;
    }
    const blockedReason = keepBlockedReason(cs, "change_set", "", true);
    if (blockedReason !== "") {
      logger.warn("Eval try keep skipped: set cannot be approved whole", {
        executionId: runId,
        changeSetId: cs.id,
        blockedReason,
      });
      continue;
    }
    kept.push(setKeep(runId, cs, "eval_try", EVAL_TRY_KEEP_REASON));
  }
  return kept;
}

/** The reason on a keep the next message made. */
const NEXT_TURN_KEEP_REASON =
  "Kept automatically: the next message was sent before these edits were decided";

/**
 * The close of a turn's file review: once a later message is sent, every
 * still-undecided file of the run's sets is kept, origin next_turn. A set
 * nobody decided gets one change-set keep; a set decided in part gets one
 * file keep per file not yet decided, so a person's decisions stand. A set
 * still being captured is left for the write that captures it, which
 * closes it then (update-status.ts).
 *
 * No completeness gate: the files are already on disk, and keeping them is
 * what the conversation did by moving on, so an unreviewable or binary
 * file is kept as it is.
 */
export function keepOutdatedSets(
  sets: ReadonlyArray<FileChangeSet>,
  runId: string,
  log: RunReviewLog,
): SessionEvent[] {
  const kept: SessionEvent[] = [];
  for (const cs of sets) {
    const decisions = decisionsOn(log, cs.id);
    if (awaitsReview(cs, decisions)) {
      kept.push(...nextTurnKeeps(runId, cs, decisions));
    }
  }
  return kept;
}

/** The keeps that close one undecided or partly decided set, by the log's decisions on it. */
function nextTurnKeeps(runId: string, cs: FileChangeSet, decisions: ReadonlyArray<LoggedDecision>): SessionEvent[] {
  if (decisions.length === 0) {
    return [setKeep(runId, cs, "next_turn", NEXT_TURN_KEEP_REASON)];
  }
  const undecided = new Set(undecidedFileIds(cs, decisions));
  return cs.changes
    .filter((change) => undecided.has(change.id))
    .map((change) =>
      decidedEvent(runId, {
        changeSetId: cs.id,
        scope: "file",
        fileChangeId: change.id,
        action: "keep",
        expectedDigest: change.fileDigest,
        origin: "next_turn",
        reason: NEXT_TURN_KEEP_REASON,
        decidedBy: "",
      }),
    );
}

/** A rule's keep of a whole set, bound to its aggregate digest. */
function setKeep(
  runId: string,
  cs: FileChangeSet,
  origin: "approved_command" | "eval_try" | "next_turn",
  reason: string,
): SessionEvent {
  return decidedEvent(runId, {
    changeSetId: cs.id,
    scope: "change_set",
    fileChangeId: "",
    action: "keep",
    expectedDigest: cs.aggregateDigest,
    origin,
    reason,
    decidedBy: "",
  });
}
