/**
 * Streaming persist decision for a harness turn.
 *
 * Harness-agnostic, and both adapters' stream loops read it
 * (`execute-cursor/turn-stream.ts`, `execute-deep-agent/turn-stream.ts`; the
 * native orchestrator's own copy of the rule retired with it in #1096):
 * `shouldPersist = transcriptDirty || scheduler.shouldSendUpdate(eventCount)`.
 * Both harnesses thus share one cadence model — a discrete state change
 * flushes immediately, high-frequency token deltas ride a bounded time
 * cadence.
 *
 * One flag, the transcript builder's `dirty` (since #1097). Until then the
 * decision took three Cursor-named flags — the delta enricher's, the todo
 * tracker's and the accumulator's — of which two were constant `false` on
 * both loops once the one builder folded every discrete change; a shape
 * that named writers which no longer existed.
 *
 * Extracted as a single pure function so the stream loop and its unit tests
 * exercise the same implementation and cannot drift.
 */

import type { StreamingUpdateScheduler } from "./streaming-scheduler.js";

/**
 * Decide whether to persist the streaming status after a stream event.
 *
 * - `transcriptDirty`: a discrete, user-visible change landed on the
 *   transcript since the last persist (a row started or settled, a sub-agent
 *   delegated, a todo written, an artifact registered) and must reach the
 *   live stream now, so short turns are never starved.
 * - scheduler: the shared StreamingUpdateScheduler carries assistant text and
 *   model thinking on a bounded time cadence (500ms floor / 5s keepalive),
 *   avoiding a per-token persist storm.
 *
 * After a persist, the caller calls `scheduler.markUpdateSent(eventCount)` so
 * the cadence resets, and clears the builder's flag as it requests the write.
 *
 * @param nowMs Injectable clock forwarded to the scheduler, for tests.
 */
export function shouldPersistStreamingStatus(
  transcriptDirty: boolean,
  scheduler: StreamingUpdateScheduler,
  eventCount: number,
  nowMs?: number,
): boolean {
  return transcriptDirty || scheduler.shouldSendUpdate(eventCount, nowMs);
}
