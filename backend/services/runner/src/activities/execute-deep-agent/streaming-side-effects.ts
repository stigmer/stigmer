/**
 * The inline-publish trigger of the native stream: a v3 `tools` event carries
 * the tool INPUT on `tool-started` and the OUTPUT on `tool-finished`, so the
 * two are correlated by `tool_call_id` and a file-modifying tool's target
 * path is published (`InlinePublisher`) once the call has finished — the
 * artifact appears on the status mid-turn, not at the end.
 *
 * Until S3 M2b (Q-M1-1) the same correlation also fed the write-back
 * coordinator's per-file commit (`onFileModified`); write-back is
 * finalize-only now, the turn runtime's, so publishing is this trigger's one
 * effect. The loop (`turn-stream.ts`) drains {@link pendingPublishPromises}
 * in the settle.
 */

import type { V3ProtocolEvent } from "./v3-event-recorder.js";
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

  onProtocolEvent(event: V3ProtocolEvent): void {
    if (event.method !== "tools") return;
    if (!this.inlinePublisher) return;

    const data = event.params.data as Record<string, unknown> | undefined;
    if (!data) return;

    const eventType = (data.event ?? data.type) as string | undefined;
    const callId = (data.tool_call_id ?? data.toolCallId) as string | undefined;
    if (!callId) return;

    if (eventType === "tool-started") {
      const toolName = (data.tool_name ?? data.toolName ?? data.name ?? "") as string;
      const rawInput = data.input;
      let input: Record<string, unknown> = {};
      if (typeof rawInput === "string") {
        try { input = JSON.parse(rawInput); } catch { /* leave empty */ }
      } else if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
        input = rawInput as Record<string, unknown>;
      }
      this.inputCache.set(callId, { toolName, input });
      return;
    }

    if (eventType === "tool-finished") {
      const cached = this.inputCache.get(callId);
      this.inputCache.delete(callId);
      if (!cached) return;
      if (!isFileModifyingTool(cached.toolName)) return;

      const filePath = extractFilePath(cached.input);
      if (!filePath) return;

      this.pendingPublishPromises.push(this.inlinePublisher.publish(filePath));
    }
  }
}
