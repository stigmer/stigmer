/**
 * The words a file-review decision is spoken in on the session's side
 * (reviewFileChanges' input, the stigmer.file_review.decided event) and
 * the ledger's enums they stand for (run/v1/filereview.proto). One table,
 * read both ways, so a word the server accepts is the word it writes.
 *
 *   scope ..... change_set CHANGE_SET, file FILE
 *   action .... keep APPROVE, undo REJECT
 *   origin .... person USER (and UNSPECIFIED, the ledger's older rows),
 *               approved_command POLICY_APPROVED_COMMAND, eval_try
 *               POLICY_EVAL_TRY, next_turn POLICY_NEXT_TURN
 *
 * The events carry words rather than the ledger's enums because
 * session/v1 cannot import run/v1 (run/v1/invocation.proto imports
 * session/v1), so each word is validated by the event's own `in` rule.
 *
 * Proven by ../../events/__tests__/catalog.test.ts, which validates every
 * word against the events' rules. A value with no word (UNSPECIFIED scope
 * or action, which no decision carries, or a value newer than this
 * binary) is undefined.
 */
import {
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

/** A decision's scope word, or undefined for UNSPECIFIED, which no decision carries. */
export function scopeWordOf(scope: FileDecisionScope): string | undefined {
  switch (scope) {
    case FileDecisionScope.CHANGE_SET:
      return "change_set";
    case FileDecisionScope.FILE:
      return "file";
    case FileDecisionScope.UNSPECIFIED:
      return undefined;
    default: {
      const unknown: never = scope;
      return noWord(unknown);
    }
  }
}

/** A decision's action word, or undefined for UNSPECIFIED, which no decision carries. */
export function actionWordOf(action: FileDecisionAction): string | undefined {
  switch (action) {
    case FileDecisionAction.APPROVE:
      return "keep";
    case FileDecisionAction.REJECT:
      return "undo";
    case FileDecisionAction.UNSPECIFIED:
      return undefined;
    default: {
      const unknown: never = action;
      return noWord(unknown);
    }
  }
}

/** Who decided, as a word; an UNSPECIFIED origin is a person's, as the ledger's oldest rows are. */
export function originWordOf(origin: FileDecisionOrigin): string | undefined {
  switch (origin) {
    case FileDecisionOrigin.UNSPECIFIED:
    case FileDecisionOrigin.USER:
      return "person";
    case FileDecisionOrigin.POLICY_APPROVED_COMMAND:
      return "approved_command";
    case FileDecisionOrigin.POLICY_EVAL_TRY:
      return "eval_try";
    case FileDecisionOrigin.POLICY_NEXT_TURN:
      return "next_turn";
    default: {
      const unknown: never = origin;
      return noWord(unknown);
    }
  }
}

/**
 * A decoded enum value outside the union this binary compiled against (a
 * newer binary's write, during a roll) has no word.
 */
function noWord(_value: never): undefined {
  return undefined;
}

/** The ledger scope a word names; undefined for any other word (the input's rule refuses one first). */
export function scopeOfWord(word: string): FileDecisionScope | undefined {
  switch (word) {
    case "change_set":
      return FileDecisionScope.CHANGE_SET;
    case "file":
      return FileDecisionScope.FILE;
    default:
      return undefined;
  }
}

/** The ledger action a word names; undefined for any other word (the input's rule refuses one first). */
export function actionOfWord(word: string): FileDecisionAction | undefined {
  switch (word) {
    case "keep":
      return FileDecisionAction.APPROVE;
    case "undo":
      return FileDecisionAction.REJECT;
    default:
      return undefined;
  }
}
