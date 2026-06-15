/**
 * Streaming persist decision for the Cursor harness.
 *
 * Mirrors the native deep-agent harness (execute-deep-agent/streaming.ts):
 * `shouldPersist = forceFlush || scheduler.shouldSendUpdate(eventCount)`.
 * Both harnesses thus share one cadence model — discrete state changes flush
 * immediately, high-frequency token deltas ride a bounded time cadence.
 *
 * Extracted as a single pure function so the stream loop and its unit tests
 * exercise the same implementation and cannot drift.
 */

import type { StreamingUpdateScheduler } from "../../shared/streaming-scheduler.js";

/**
 * Force-flush signals — discrete, user-visible state changes that must reach the
 * live stream immediately, independent of the scheduler's time cadence.
 */
export interface ForceFlushSignals {
  /** Shell/tool output text accumulated past the delta-enricher debounce. */
  readonly deltaEnricherDirty: boolean;
  /** The agent's todo list changed. */
  readonly todosDirty: boolean;
  /**
   * A tool call started or reached a terminal status, or a sub-agent was
   * delegated/updated (MessageAccumulator.isDirty).
   */
  readonly contentDirty: boolean;
}

/**
 * Decide whether to persist the streaming status after a stream event.
 *
 * - forceFlush: any discrete signal flushes now so the live trace (tool calls,
 *   sub-agents, todos, shell output) is never starved on short turns.
 * - scheduler: the shared StreamingUpdateScheduler carries assistant text and
 *   model thinking on a bounded time cadence (500ms floor / 5s keepalive),
 *   avoiding a per-token persist storm.
 *
 * After a persist, the caller must call scheduler.markUpdateSent(eventCount) so
 * the cadence resets — matching the native harness.
 *
 * @param nowMs Injectable clock forwarded to the scheduler, for tests.
 */
export function shouldPersistStreamingStatus(
  signals: ForceFlushSignals,
  scheduler: StreamingUpdateScheduler,
  eventCount: number,
  nowMs?: number,
): boolean {
  const forceFlush =
    signals.deltaEnricherDirty || signals.todosDirty || signals.contentDirty;
  return forceFlush || scheduler.shouldSendUpdate(eventCount, nowMs);
}
