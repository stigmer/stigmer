/**
 * What a Claude session's saved transcript says about the run an invocation
 * serves, read from the session store before the engine starts.
 *
 * The engine keeps a user message's id as its transcript entry's own, and
 * records a message it absorbed mid-turn by that message's id
 * (`source_uuid` on its `queued_command` attachment): measured on SDK
 * 0.3.310. Every message this harness hands the engine is sent under an id
 * derived from the platform's own (`engine-session-id.ts`), so the
 * transcript answers three questions by identity, with no state kept
 * beside it:
 *
 *  - whether this run's message was already taken (a continued turn: the
 *    engine is never handed the task again);
 *  - which messages a person sent while the turn worked it already read;
 *  - whether the engine had finished the run: its last word on the main
 *    thread is an assistant message with no tool call after it;
 *  - the call the main thread left pending: the last main-thread tool call
 *    with no result after it, which is where a deferral leaves the
 *    transcript (measured on SDK 0.3.310: the call's entry and a
 *    `hook_deferred_tool` attachment, no result), and where a stopped run's
 *    deferral is still found by the next run.
 *
 * Entries are the engine's internal transcript format, read structurally
 * and only for these fields; a field it stops writing reads as "not taken"
 * and "not finished", the safe direction (the engine is asked again, never
 * skipped).
 */

import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

/** The facts an invocation reads (the header). */
export interface TranscriptFacts {
  /** Whether the session has a transcript at all. */
  readonly exists: boolean;
  /** Every id the transcript took a message under. */
  readonly taken: ReadonlySet<string>;
  /** Whether the main thread's last word is the model's, with no call after it. */
  readonly finished: boolean;
  /** The id of the last main-thread call with no result; undefined when every call has one. */
  readonly pendingCall: string | undefined;
}

/** The facts of a main transcript as loaded (`null`: never written). */
export function transcriptFactsOf(entries: readonly SessionStoreEntry[] | null): TranscriptFacts {
  if (entries === null) return { exists: false, taken: new Set(), finished: false, pendingCall: undefined };
  const taken = new Set<string>();
  let last: SessionStoreEntry | undefined;
  const calls: string[] = [];
  const answered = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "user" && typeof entry.uuid === "string") taken.add(entry.uuid);
    const absorbed = (entry.attachment as { source_uuid?: unknown } | undefined)?.source_uuid;
    if (entry.type === "attachment" && typeof absorbed === "string") taken.add(absorbed);
    if ((entry.type !== "user" && entry.type !== "assistant") || entry.isSidechain === true) continue;
    last = entry;
    for (const block of blocksOf(entry)) {
      if (entry.type === "assistant" && block.type === "tool_use" && typeof block.id === "string") calls.push(block.id);
      if (entry.type === "user" && block.type === "tool_result" && typeof block.tool_use_id === "string") answered.add(block.tool_use_id);
    }
  }
  const finished = last !== undefined && last.type === "assistant" && !blocksOf(last).some((block) => block.type === "tool_use");
  return { exists: true, taken, finished, pendingCall: calls.filter((id) => !answered.has(id)).at(-1) };
}

/** An entry's content blocks, read by shape. */
function blocksOf(entry: SessionStoreEntry): readonly { readonly type?: unknown; readonly id?: unknown; readonly tool_use_id?: unknown }[] {
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content as { type?: unknown }[]) : [];
}
