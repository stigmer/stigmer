/**
 * A run's file review as its session's log states it: what was decided on
 * its change sets, and which of its calls a person allowed. Every
 * file-review decision reads these from the log.
 *
 *   decisions .. the run's `stigmer.file_review.decided` events, in log
 *                order, in the event's words (../../session/filereview/
 *                words.ts). A change-set decision covers every file of its
 *                set, a file decision its one file; a file is undecided
 *                while none covers it, the rule the clients' fold applies
 *                (`@stigmer/session-log`).
 *   allowed .... the run's tool uses a person allowed: a
 *                `user.tool_confirmation` with result allow, which only
 *                the server writes (confirmToolUse, grantPermission). The
 *                consent an approved-command keep verifies.
 *
 * Which sets a run has and which files each changed are its file record
 * (record.ts): a set is offered for review once its candidate is captured.
 * Whether files were put back is the log's `stigmer.file_review.reconciled`,
 * an outcome that decides nothing here.
 *
 * A writer reads the run's events of RUN_REVIEW_EVENT_TYPES under the lock
 * it writes under (store/session-events.ts `runEventTypes`), so a decision
 * landing meanwhile is seen; a writer that records several decisions in
 * one write folds each into the log it decides the next from
 * (`withDecisions`).
 *
 * Proven by __tests__/logged.test.ts, and through every writer in
 * autokeep.test.ts, ../../session/filereview/__tests__/decide.test.ts and
 * ../../session/filereview/__tests__/log-only-decisions.test.ts.
 */
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { actionOfWord, scopeOfWord } from "../../session/filereview/words.js";
import type { ActionWord, ScopeWord } from "../../session/filereview/words.js";
import { isCaptured } from "./record.js";

/** The decided event's type. */
export const FILE_REVIEW_DECIDED_TYPE = "stigmer.file_review.decided";

/** The confirmation's type. */
export const TOOL_CONFIRMATION_TYPE = "user.tool_confirmation";

/** The types a writer reads to decide on a run's file review (module header). */
export const RUN_REVIEW_EVENT_TYPES: ReadonlyArray<string> = [FILE_REVIEW_DECIDED_TYPE, TOOL_CONFIRMATION_TYPE];

/** The origin word of a person's decision. */
export const PERSON_ORIGIN = "person";

/** One decision the log holds. */
export interface LoggedDecision {
  readonly changeSetId: string;
  readonly scope: ScopeWord;
  /** The file decided; "" for a change-set decision. */
  readonly fileChangeId: string;
  readonly action: ActionWord;
  /** Who decided, as the event's word: person, approved_command, eval_try or next_turn. */
  readonly origin: string;
  /** The account of the person who decided; "" for a rule's keep, or a decision written before the event named its decider. */
  readonly decidedBy: string;
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
        const decision = loggedDecisionOf(event);
        if (decision !== undefined) {
          decisions.push(decision);
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

/**
 * A decided event as a decision; undefined for any other event, and for a
 * word this binary does not know (a newer one's, during a roll), which is
 * not a decision it can read.
 */
export function loggedDecisionOf(event: SessionEvent): LoggedDecision | undefined {
  if (event.event.case !== "stigmerFileReviewDecided") {
    return undefined;
  }
  const decided = event.event.value;
  const scope = scopeOfWord(decided.scope);
  const action = actionOfWord(decided.action);
  if (scope === undefined || action === undefined) {
    return undefined;
  }
  return {
    changeSetId: decided.changeSetId,
    scope,
    fileChangeId: scope === "file" ? decided.fileChangeId : "",
    action,
    origin: decided.origin,
    decidedBy: decided.decidedBy,
  };
}

/** The log once `events` (decided events a write is about to append) are in it. */
export function withDecisions(log: RunReviewLog, events: ReadonlyArray<SessionEvent>): RunReviewLog {
  if (events.length === 0) {
    return log;
  }
  return { decisions: [...log.decisions, ...runReviewLogOf(events).decisions], allowed: log.allowed };
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
  scope: ScopeWord,
  fileChangeId: string,
): LoggedDecision | undefined {
  return decisionsOn(log, changeSetId).find(
    (decision) => decision.scope === scope && (scope !== "file" || decision.fileChangeId === fileChangeId),
  );
}

/** The files of a captured set no decision covers, in the capture's order. */
export function undecidedFileIds(cs: FileChangeSet, decisions: ReadonlyArray<LoggedDecision>): string[] {
  if (decisions.some((decision) => decision.scope === "change_set")) {
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
