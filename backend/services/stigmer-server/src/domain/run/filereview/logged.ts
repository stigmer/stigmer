/**
 * A run's file review as its session's log states it: what was decided on
 * its change sets, and which of its calls a person allowed. Every
 * file-review decision reads these from the log, never from the run's
 * ledger (author.ts), which is still written beside the log for the
 * readers that read it.
 *
 *   decisions .. the run's `stigmer.file_review.decided` events, in log
 *                order, in the ledger's terms (../../session/filereview/
 *                words.ts, the one table). A change-set decision covers
 *                every file of its set, a file decision its one file; a
 *                file is undecided while none covers it, the rule the
 *                clients' fold applies (`@stigmer/session-log`).
 *   allowed .... the run's tool uses a person allowed: a
 *                `user.tool_confirmation` with result allow, which only
 *                the server writes (confirmToolUse, grantPermission). The
 *                consent an approved-command keep verifies.
 *
 * Which sets a run has and which files each changed are its capture: the
 * ledger's baseline and candidate (project.ts), the bytes a decision is
 * checked against. A set is offered for review once its candidate is
 * captured; the ledger's RECONCILED and FAILED events are outcomes the
 * log states instead (`stigmer.file_review.reconciled`), so they decide
 * nothing here.
 *
 * A writer reads the run's events of RUN_REVIEW_EVENT_TYPES under the lock
 * it writes under (store/session-events.ts `runEventTypes`), so a decision
 * landing meanwhile is seen.
 *
 * Proven by __tests__/logged.test.ts, and through every writer in
 * autokeep.test.ts, ../../session/filereview/__tests__/decide.test.ts and
 * ../../session/filereview/__tests__/log-only-decisions.test.ts.
 */
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { actionOfWord, scopeOfWord } from "../../session/filereview/words.js";

/** The decided event's type. */
export const FILE_REVIEW_DECIDED_TYPE = "stigmer.file_review.decided";

/** The confirmation's type. */
export const TOOL_CONFIRMATION_TYPE = "user.tool_confirmation";

/** The types a writer reads to decide on a run's file review (module header). */
export const RUN_REVIEW_EVENT_TYPES: ReadonlyArray<string> = [FILE_REVIEW_DECIDED_TYPE, TOOL_CONFIRMATION_TYPE];

/** The origin word of a person's decision. */
export const PERSON_ORIGIN = "person";

/** One decision the log holds, in the ledger's terms. */
export interface LoggedDecision {
  readonly changeSetId: string;
  readonly scope: FileDecisionScope;
  /** The file decided; "" for a change-set decision. */
  readonly fileChangeId: string;
  readonly action: FileDecisionAction;
  /** Who decided, as the event's word: person, approved_command, eval_try or next_turn. */
  readonly origin: string;
}

/** A run's file review as its log states it (module header). */
export interface RunReviewLog {
  /** In log order. */
  readonly decisions: ReadonlyArray<LoggedDecision>;
  /** The tool use ids a person allowed. */
  readonly allowed: ReadonlySet<string>;
}

/** The log of a run with no decision and no answer. */
export const EMPTY_RUN_REVIEW_LOG: RunReviewLog = { decisions: [], allowed: new Set() };

/** A run's review log from its events (any others are passed over). */
export function runReviewLogOf(events: Iterable<SessionEvent>): RunReviewLog {
  const decisions: LoggedDecision[] = [];
  const allowed = new Set<string>();
  for (const event of events) {
    switch (event.event.case) {
      case "stigmerFileReviewDecided": {
        const decided = event.event.value;
        const scope = scopeOfWord(decided.scope);
        const action = actionOfWord(decided.action);
        // A word this binary does not know (a newer one's, during a roll)
        // is not a decision it can read.
        if (scope !== undefined && action !== undefined) {
          decisions.push({
            changeSetId: decided.changeSetId,
            scope,
            fileChangeId: scope === FileDecisionScope.FILE ? decided.fileChangeId : "",
            action,
            origin: decided.origin,
          });
        }
        break;
      }
      case "userToolConfirmation":
        if (event.event.value.result === "allow") {
          allowed.add(event.event.value.toolUseId);
        }
        break;
      default:
        break;
    }
  }
  return { decisions, allowed };
}

/** The decisions on one change set, in log order. */
export function decisionsOn(log: RunReviewLog, changeSetId: string): LoggedDecision[] {
  return log.decisions.filter((decision) => decision.changeSetId === changeSetId);
}

/**
 * The first decision on exactly this target: the set, for a change-set
 * scope, or the one file. A target's decision is final, so there is at
 * most one that counts.
 */
export function decisionOnTarget(
  log: RunReviewLog,
  changeSetId: string,
  scope: FileDecisionScope,
  fileChangeId: string,
): LoggedDecision | undefined {
  return decisionsOn(log, changeSetId).find(
    (decision) =>
      decision.scope === scope && (scope !== FileDecisionScope.FILE || decision.fileChangeId === fileChangeId),
  );
}

/** Whether a set's candidate is captured: it is offered for review (module header). */
export function isCaptured(cs: FileChangeSet): boolean {
  return cs.status !== FileChangeSetStatus.UNSPECIFIED && cs.status !== FileChangeSetStatus.CAPTURING;
}

/** The files of a captured set no decision covers, in the capture's order. */
export function undecidedFileIds(cs: FileChangeSet, decisions: ReadonlyArray<LoggedDecision>): string[] {
  if (decisions.some((decision) => decision.scope === FileDecisionScope.CHANGE_SET)) {
    return [];
  }
  const decided = new Set(decisions.map((decision) => decision.fileChangeId));
  return cs.changes.filter((change) => !decided.has(change.id)).map((change) => change.id);
}

/**
 * Whether a set still awaits a decision: captured, with a file no
 * decision covers (a capture that changed no file awaits one until any
 * decision is made).
 */
export function awaitsReview(cs: FileChangeSet, decisions: ReadonlyArray<LoggedDecision>): boolean {
  if (!isCaptured(cs)) {
    return false;
  }
  return cs.changes.length === 0 ? decisions.length === 0 : undecidedFileIds(cs, decisions).length > 0;
}
