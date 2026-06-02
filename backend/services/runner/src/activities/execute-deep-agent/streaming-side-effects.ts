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

const FILE_MODIFYING_TOOLS = new Set([
  "write_file", "edit_file", "create_file",
  "write", "edit", "create",
  "str_replace_editor",
]);

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
      if (!FILE_MODIFYING_TOOLS.has(cached.toolName)) return;

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

function extractFilePath(input: Record<string, unknown>): string | null {
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.filePath === "string") return input.filePath;
  if (typeof input.filename === "string") return input.filename;
  if (typeof input.file === "string") return input.file;
  return null;
}
