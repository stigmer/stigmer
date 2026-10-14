/**
 * The words a file-review decision is spoken in: reviewFileChanges' input
 * and the stigmer.file_review.decided event say a decision in the same
 * words, and the server decides in them too. One table, so a word the
 * server accepts is the word it writes.
 *
 *   scope ..... change_set (every file of the set), file (one file)
 *   action .... keep (the change stays), undo (the file is put back)
 *   origin .... person, approved_command, eval_try, next_turn (who decided)
 *
 * Each word is validated by the event's own `in` rule. Proven by
 * ../../events/__tests__/catalog.test.ts, which validates every word
 * against the events' rules.
 */

/** What a decision covers. */
export type ScopeWord = "change_set" | "file";

/** What a decision does. */
export type ActionWord = "keep" | "undo";

/** Who decided: a person, or the rule that kept the change on their behalf. */
export type OriginWord = "person" | "approved_command" | "eval_try" | "next_turn";

/** Every scope word, in the event's order. */
export const SCOPE_WORDS: ReadonlyArray<ScopeWord> = ["change_set", "file"];

/** Every action word, in the event's order. */
export const ACTION_WORDS: ReadonlyArray<ActionWord> = ["keep", "undo"];

/** Every origin word, in the event's order. */
export const ORIGIN_WORDS: ReadonlyArray<OriginWord> = ["person", "approved_command", "eval_try", "next_turn"];

/** The scope a word names; undefined for any other word (the input's rule refuses one first). */
export function scopeOfWord(word: string): ScopeWord | undefined {
  return SCOPE_WORDS.find((scope) => scope === word);
}

/** The action a word names; undefined for any other word (the input's rule refuses one first). */
export function actionOfWord(word: string): ActionWord | undefined {
  return ACTION_WORDS.find((action) => action === word);
}
