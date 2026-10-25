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
 *    thread is an assistant message with no tool call after it.
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
}

/** The facts of a main transcript as loaded (`null`: never written). */
export function transcriptFactsOf(entries: readonly SessionStoreEntry[] | null): TranscriptFacts {
  if (entries === null) return { exists: false, taken: new Set(), finished: false };
  const taken = new Set<string>();
  let last: SessionStoreEntry | undefined;
  for (const entry of entries) {
    if (entry.type === "user" && typeof entry.uuid === "string") taken.add(entry.uuid);
    const absorbed = (entry.attachment as { source_uuid?: unknown } | undefined)?.source_uuid;
    if (entry.type === "attachment" && typeof absorbed === "string") taken.add(absorbed);
    if ((entry.type === "user" || entry.type === "assistant") && entry.isSidechain !== true) last = entry;
  }
  return { exists: true, taken, finished: last !== undefined && last.type === "assistant" && !callsATool(last) };
}

/** Whether an assistant entry's content holds a tool call. */
function callsATool(entry: SessionStoreEntry): boolean {
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) && content.some((block: unknown) => (block as { type?: unknown }).type === "tool_use");
}
