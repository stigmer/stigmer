/**
 * The inline-publish trigger of the native stream: a `tool_started` carries
 * the tool's INPUT and a `tool_finished` its completion, so the two are
 * correlated by `callId` and a file-modifying tool's target path is published
 * (`InlinePublisher`) once the call has finished — the artifact appears on
 * the status mid-turn, not at the end.
 *
 * Reads the canonical `TranscriptEvent`s the translator emits, never the raw
 * v3 wire (S4 M2 C3b, Q-M2-10): until then this trigger re-implemented the
 * translator's field parsers (`tool_call_id`/`toolCallId`, the input as a
 * string or an object) to read the same two facts off the raw event, a
 * second parser of the wire that could drift from the first. After C3b the
 * raw event has two readers in the loop — the recorder, which records it
 * raw by design, and `usageOf` — and everything else reads the translation.
 *
 * Until S3 M2b (Q-M1-1) the same correlation also fed the write-back
 * coordinator's per-file commit (`onFileModified`); write-back is
 * finalize-only now, the turn runtime's, so publishing is this trigger's one
 * effect. The loop (`turn-stream.ts`) drains {@link pendingPublishPromises}
 * in the settle.
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

  readonly pendingPublishPromises: Promise<void>[] = [];

  constructor(opts: { inlinePublisher?: InlinePublisher }) {
    this.inlinePublisher = opts.inlinePublisher;
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
      this.pendingPublishPromises.push(this.inlinePublisher.publish(filePath));
    }
  }
}
