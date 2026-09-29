/**
 * The inline-publish trigger of the native stream: a `tool_started` carries
 * the tool's INPUT and a `tool_finished` its completion, so the two are
 * correlated by `callId` and a file-modifying tool's target path is published
 * (`InlinePublisher`) once the call has finished — the artifact appears on
 * the status mid-turn, not at the end.
 *
 * Reads the canonical `TranscriptEvent`s the translator emits, never the raw
 * v3 wire (since #1097): until then this trigger re-implemented the
 * translator's field parsers (`tool_call_id`/`toolCallId`, the input as a
 * string or an object) to read the same two facts off the raw event, a
 * second parser of the wire that could drift from the first. Since then the
 * raw event has two readers in the loop — the recorder, which records it
 * raw by design, and `usageOf` — and everything else reads the translation.
 *
 * Until #1096 the same correlation also fed the write-back
 * coordinator's per-file commit (`onFileModified`); write-back is
 * finalize-only now, the turn runtime's, so publishing is this trigger's one
 * effect.
 *
 * One instance per turn, owned by the turn's transcript
 * (`turn-stream.ts` `createDeepAgentTranscript`) and not by the stream loop,
 * so the in-flight publishes outlive a stream that throws: the settle
 * drains them before its safety net, and the turn's `finally`
 * (`turn.ts`) drains them on every exit, a thrown turn included, before the
 * runtime writes the terminal status (stigmer#1116). Until then the loop
 * built this and handed the list out only on its return values, so a turn
 * that threw left its uploads to land on a status already persisted for the
 * last time.
 */

import type { TranscriptEvent } from "../../harness/transcript/events.js";
import type { InlinePublisher } from "./inline-publisher.js";
import { extractFilePath, isFileModifyingTool } from "../../shared/file-tools.js";

interface CachedToolInput {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export class StreamingSideEffects {
  private readonly inputCache = new Map<string, CachedToolInput>();
  private readonly inlinePublisher: InlinePublisher | undefined;

  private readonly pending: Promise<void>[] = [];

  constructor(opts: { inlinePublisher?: InlinePublisher }) {
    this.inlinePublisher = opts.inlinePublisher;
  }

  /** The publishes fired so far, in order; each resolves (a publish logs and swallows its own failure). */
  get pendingPublishPromises(): readonly Promise<void>[] {
    return this.pending;
  }

  /**
   * Wait for every publish fired so far to land on the status. Idempotent:
   * a second call over settled publishes returns at once. Bounded by the
   * artifact storage's own per-call timeouts, as every drain has been.
   */
  async drainPublishes(): Promise<void> {
    if (this.pending.length > 0) await Promise.allSettled(this.pending);
  }

  onEvent(event: TranscriptEvent): void {
    if (!this.inlinePublisher) return;

    if (event.kind === "tool_started") {
      this.inputCache.set(event.callId, { toolName: event.name, input: event.input });
      return;
    }

    if (event.kind === "tool_finished") {
      const cached = this.inputCache.get(event.callId);
      this.inputCache.delete(event.callId);
      if (!cached) return;
      if (!isFileModifyingTool(cached.toolName)) return;
      const filePath = extractFilePath(cached.input);
      if (!filePath) return;
      this.pending.push(this.inlinePublisher.publish(filePath));
    }
  }
}
