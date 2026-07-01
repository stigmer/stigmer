/**
 * Side-effect triggers for v3 streaming: artifact publish and git writeback.
 *
 * v3 `tool-finished` events do not carry input — unlike v2 `on_tool_end`.
 * A ToolInputCache correlates `tool-started` input with `tool-finished`
 * by `tool_call_id` so file paths can be extracted for publish/writeback.
 */

import type { V3ProtocolEvent } from "./v3-event-recorder.js";
import type { InlinePublisher } from "./inline-publisher.js";
import type { WriteBackCoordinator } from "./writeback-coordinator.js";
import { extractFilePath, isFileModifyingTool } from "../../shared/file-tools.js";

interface CachedToolInput {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export class StreamingSideEffects {
  private readonly inputCache = new Map<string, CachedToolInput>();
  private readonly inlinePublisher: InlinePublisher | undefined;
  private readonly writebackCoordinator: WriteBackCoordinator | undefined;
  readonly pendingPublishPromises: Promise<void>[] = [];
  readonly pendingWritebackPromises: Promise<void>[] = [];

  constructor(opts: {
    inlinePublisher?: InlinePublisher;
    writebackCoordinator?: WriteBackCoordinator;
  }) {
    this.inlinePublisher = opts.inlinePublisher;
    this.writebackCoordinator = opts.writebackCoordinator;
  }

  onProtocolEvent(event: V3ProtocolEvent): void {
    if (event.method !== "tools") return;
    if (!this.inlinePublisher && !this.writebackCoordinator) return;

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

      if (this.inlinePublisher) {
        this.pendingPublishPromises.push(this.inlinePublisher.publish(filePath));
      }
      if (this.writebackCoordinator) {
        this.pendingWritebackPromises.push(this.writebackCoordinator.onFileModified(filePath));
      }
    }
  }
}
