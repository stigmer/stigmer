/**
 * The ids a run's session events carry: derived from the run and the row
 * each event describes, never minted, so a resumed or retried turn names
 * the same fact the same way and the session log (which refuses a second
 * event under one id) recognises what it already holds.
 *
 * Every id is unique in its session by construction: each begins with the
 * run's id, and run ids are server-minted `run_<ulid>` and hold no `.`, so
 * the first `.` ends the run part. Within a run:
 *
 *   tool use ........... <run>.<call id>           (the provider's call id)
 *   tool result ........ <tool use>.r
 *   its full output .... <tool use>.full    (an offloaded result's storage key)
 *   permission asked ... <tool use>.ask
 *   message ............ <run>.<scope>.m<index>
 *   thinking ........... <run>.<scope>.t<index>, its text <...>.text
 *   harness note ....... <run>.<scope>.n<index>
 *   thread ............. <run>.<sub-agent id>       (a thread id, not an event id)
 *   thread events ...... <thread>.created | .running | .sent | .received | .idle
 *   structured output .. <run>.output
 *   memory recall ...... <run>.memory
 *   file changes ....... <run>.fr<turn seq>         (a change set, `<run>:<turn seq>`)
 *   files put back ..... <run>.fr<turn seq>.r
 *
 * `scope` is `root`, or the sub-agent's row id, and `index` a row's place
 * in its scope: within one invocation its place in the scope's message
 * array, which nothing reorders or removes, numbered on from the index
 * after the highest one the log already holds in that scope. An invocation
 * builds only its own rows (a reinvocation seeds the asks it resumes onto,
 * on messages that write nothing), so a later invocation's first message
 * takes the next index and no id is ever named twice with other bytes
 * (`emitter.ts` `nextScopeIndexes`). Messages, thinking and notes share one
 * index sequence per scope. The two file-review ids derive from the change set, so the
 * second one begins with the change set's run even when another run (the
 * turn that put the files back) writes it: one per change set, whichever
 * turn reconciles it. A thread's id equals its `task` call's tool use id (the
 * sub-agent row's id is that call's id on both harnesses); thread ids and
 * event ids are separate namespaces, and the thread's own events take a
 * suffix.
 *
 * A call id or a sub-agent id is used as written only when it fits the
 * contract's id pattern with room left for the longest suffix; any other
 * becomes `h` and the first 32 hex digits of its SHA-256, so an id the
 * provider spells with a `/` or past the length limit still derives one
 * stable event id. The one reverse step a reader needs (from a tool use
 * id back to its call id) is pinned with this rule by the shared corpus
 * `apis/testdata/session-events/ids/vectors.json`
 * (`__tests__/ids-corpus.test.ts`).
 */

import { createHash } from "node:crypto";

import { changeSetIdParts } from "../../shared/filereview/events.js";

/** The contract's event id pattern (`event.proto`): letters, digits, `_ . : -`, at most 128. */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** The longest suffix any derivation appends to a tool use or a scope (`.t12345.text`, with room). */
const SUFFIX_ROOM = 16;

/** The scope segment of the root thread. */
export const ROOT_SCOPE = "root";

/**
 * One segment as written when the whole id it ends stays inside the
 * pattern with room for a suffix; its hashed form otherwise. A segment
 * equal to `root` is hashed too, so no sub-agent can name the root's scope.
 */
function segment(prefix: string, raw: string): string {
  const candidate = `${prefix}.${raw}`;
  if (raw !== ROOT_SCOPE && raw !== "" && EVENT_ID_PATTERN.test(candidate) && candidate.length + SUFFIX_ROOM <= 128) {
    return raw;
  }
  return `h${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

/** The `agent.tool_use` (or `agent.mcp_tool_use`) id of a call. */
export function toolUseEventId(runId: string, callId: string): string {
  return `${runId}.${segment(runId, callId)}`;
}

/** The result of a tool use. */
export function toolResultEventId(toolUseId: string): string {
  return `${toolUseId}.r`;
}

/** The `stigmer.tool_result.full_output` beside a result whose output was offloaded. */
export function toolResultFullOutputEventId(toolUseId: string): string {
  return `${toolUseId}.full`;
}

/** The `stigmer.permission.asked` beside a tool use that waits. */
export function permissionAskedEventId(toolUseId: string): string {
  return `${toolUseId}.ask`;
}

/** The prefix every message, thinking and note of one scope shares. */
export function scopeEventPrefix(runId: string, subAgentId: string | undefined): string {
  return subAgentId === undefined ? `${runId}.${ROOT_SCOPE}` : `${runId}.${segment(runId, subAgentId)}`;
}

/** An `agent.message`, by its row's place in its scope. */
export function messageEventId(scopePrefix: string, index: number): string {
  return `${scopePrefix}.m${index}`;
}

/** An `agent.thinking`, by its row's place in its scope. */
export function thinkingEventId(scopePrefix: string, index: number): string {
  return `${scopePrefix}.t${index}`;
}

/** The `stigmer.agent.thinking` carrying a thinking's text. */
export function thinkingTextEventId(thinkingId: string): string {
  return `${thinkingId}.text`;
}

/** A `stigmer.harness.note`, by its row's place in its scope. */
export function harnessNoteEventId(scopePrefix: string, index: number): string {
  return `${scopePrefix}.n${index}`;
}

/** A sub-agent's thread id: its `task` call's tool use id. */
export function threadId(runId: string, subAgentId: string): string {
  return toolUseEventId(runId, subAgentId);
}

/** One of a thread's own events. */
export function threadEventId(thread: string, kind: "created" | "running" | "sent" | "received" | "idle"): string {
  return `${thread}.${kind}`;
}

/** The turn's `stigmer.agent.structured_output`. */
export function structuredOutputEventId(runId: string): string {
  return `${runId}.output`;
}

/** The turn's `stigmer.memory.recalled`. */
export function memoryRecalledEventId(runId: string): string {
  return `${runId}.memory`;
}

/** A change set's `stigmer.file_review.changes`: `<run>.fr<turn seq>`, from its id `<run>:<turn seq>`. */
export function fileReviewChangesEventId(changeSetId: string): string {
  const { runId, turnSeq } = changeSetIdParts(changeSetId);
  return `${runId}.fr${turnSeq}`;
}

/**
 * The `stigmer.file_review.reconciled` that answers one undo decided on a
 * change set: its changes event's id, `.r.`, then the undo's
 * `stigmer.file_review.decided` event id. One per undo, not per set: a
 * set's files can be undone one at a time, each after the last was put back.
 */
export function fileReviewReconciledEventId(changeSetId: string, decidedEventId: string): string {
  return `${fileReviewChangesEventId(changeSetId)}.r.${decidedEventId}`;
}
