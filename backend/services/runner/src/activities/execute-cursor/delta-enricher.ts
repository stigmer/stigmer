/**
 * DeltaEnricher processes Cursor SDK InteractionUpdate events to provide
 * real-time enrichments that the stream channel alone cannot deliver.
 *
 * The Cursor SDK provides two concurrent event channels:
 *   - run.stream() (SDKMessage) — coarse-grained, post-hoc events
 *   - onDelta (InteractionUpdate) — fine-grained, real-time deltas
 *
 * The stream channel remains the source of truth for message construction.
 * The delta channel provides supplementary real-time signals:
 *   - shell-output-delta: live stdout/stderr from running shell commands
 *   - tool-call-started/completed: precise lifecycle timestamps
 *   - thinking-completed: accurate thinking duration from the SDK
 *
 * Concurrency model: Node.js is single-threaded. The onDelta callback fires
 * between iterations of the for-await stream loop (during event loop yields).
 * The enricher buffers data internally; the stream loop calls
 * applyEnrichments() on each iteration to flush buffered state onto the
 * message array. No locks needed — access is always sequential.
 *
 * Design invariant: The enricher never creates messages or tool calls.
 * It only mutates existing ones that the MessageAccumulator has created.
 * If a delta arrives before its corresponding stream event (e.g.,
 * shell-output-delta before tool_call running), the data is buffered
 * and applied retroactively on the next applyEnrichments() call that
 * finds the matching ToolCall.
 */

import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStreamingSource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { InteractionUpdate } from "@cursor/sdk";
import { utcTimestamp } from "./message-translator.js";

interface ShellOutputBuffer {
  chunks: string[];
  totalLength: number;
}

interface ToolCallTiming {
  startedAt?: string;
  completedAt?: string;
}

export class DeltaEnricher {
  private shellOutputByCallId = new Map<string, ShellOutputBuffer>();
  private timingByCallId = new Map<string, ToolCallTiming>();
  private thinkingDurationMs: number | undefined;
  private _isDirty = false;
  private lastPersistTime = 0;
  private lastShellCallId: string | undefined;

  /**
   * Minimum interval between persist-triggering dirty flags (milliseconds).
   * Prevents excessive backend writes during rapid shell output bursts.
   * Matches the Python agent-runner's update_scheduler interval.
   */
  static readonly PERSIST_DEBOUNCE_MS = 500;

  /**
   * Process a single InteractionUpdate from the onDelta callback.
   * Buffers enrichment data for later application by applyEnrichments().
   *
   * Called from the onDelta callback (between stream loop iterations).
   */
  processDelta(update: InteractionUpdate): void {
    switch (update.type) {
      case "shell-output-delta":
        this.handleShellOutputDelta(update);
        break;
      case "tool-call-started":
        this.handleToolCallStarted(update);
        break;
      case "tool-call-completed":
        this.handleToolCallCompleted(update);
        break;
      case "thinking-completed":
        this.thinkingDurationMs = update.thinkingDurationMs;
        break;
    }
  }

  /**
   * Apply all buffered enrichments to the current message array.
   * Called from the stream loop after each processEvent() iteration.
   *
   * Returns true if any enrichments were applied (messages were mutated).
   */
  applyEnrichments(messages: AgentMessage[]): boolean {
    let applied = false;

    if (this.shellOutputByCallId.size > 0) {
      applied = this.applyShellOutput(messages) || applied;
    }

    if (this.timingByCallId.size > 0) {
      applied = this.applyTiming(messages) || applied;
    }

    if (this.thinkingDurationMs !== undefined) {
      applied = this.applyThinkingDuration(messages) || applied;
    }

    return applied;
  }

  /**
   * Whether the enricher has pending data that warrants an immediate persist.
   * Only returns true when meaningful UI-visible data has arrived AND the
   * debounce interval has elapsed since the last persist.
   */
  get isDirty(): boolean {
    if (!this._isDirty) return false;
    const now = Date.now();
    return (now - this.lastPersistTime) >= DeltaEnricher.PERSIST_DEBOUNCE_MS;
  }

  /**
   * Acknowledge that a persist has occurred. Resets the dirty flag and
   * records the persist timestamp for debounce calculations.
   */
  markPersisted(): void {
    this._isDirty = false;
    this.lastPersistTime = Date.now();
  }

  /**
   * Finalize any remaining streaming state on tool calls.
   * Called after the stream loop ends (alongside accumulator.finalize()).
   */
  finalize(messages: AgentMessage[]): void {
    for (const msg of messages) {
      for (const tc of msg.toolCalls) {
        if (tc.isStreaming) {
          tc.isStreaming = false;
          tc.streamingSource = ToolCallStreamingSource.UNSPECIFIED;
        }
      }
    }
  }

  private handleShellOutputDelta(
    update: Extract<InteractionUpdate, { type: "shell-output-delta" }>,
  ): void {
    const event = update.event;
    const text = extractShellOutputText(event);
    if (!text) return;

    const callId = extractCallIdFromShellEvent(event) ?? this.lastShellCallId;
    if (!callId) return;

    let buffer = this.shellOutputByCallId.get(callId);
    if (!buffer) {
      buffer = { chunks: [], totalLength: 0 };
      this.shellOutputByCallId.set(callId, buffer);
    }

    buffer.chunks.push(text);
    buffer.totalLength += text.length;
    this._isDirty = true;
  }

  private handleToolCallStarted(
    update: Extract<InteractionUpdate, { type: "tool-call-started" }>,
  ): void {
    const timing = this.getOrCreateTiming(update.callId);
    timing.startedAt = utcTimestamp();

    if (update.toolCall.type === "shell") {
      this.lastShellCallId = update.callId;
    }
  }

  private handleToolCallCompleted(
    update: Extract<InteractionUpdate, { type: "tool-call-completed" }>,
  ): void {
    const timing = this.getOrCreateTiming(update.callId);
    timing.completedAt = utcTimestamp();
  }

  private getOrCreateTiming(callId: string): ToolCallTiming {
    let timing = this.timingByCallId.get(callId);
    if (!timing) {
      timing = {};
      this.timingByCallId.set(callId, timing);
    }
    return timing;
  }

  private applyShellOutput(messages: AgentMessage[]): boolean {
    let applied = false;

    for (const [callId, buffer] of this.shellOutputByCallId) {
      const tc = findToolCallById(messages, callId);
      if (!tc) continue;

      const content = buffer.chunks.join("");
      tc.result = content;
      tc.isStreaming = true;
      tc.streamingSource = ToolCallStreamingSource.OUTPUT;

      buffer.chunks = [content];
      applied = true;
    }

    return applied;
  }

  private applyTiming(messages: AgentMessage[]): boolean {
    let applied = false;

    for (const [callId, timing] of this.timingByCallId) {
      const tc = findToolCallById(messages, callId);
      if (!tc) continue;

      if (timing.startedAt && !tc.startedAt) {
        tc.startedAt = timing.startedAt;
        applied = true;
      }
      if (timing.completedAt && !tc.completedAt) {
        tc.completedAt = timing.completedAt;
        applied = true;
      }

      this.timingByCallId.delete(callId);
    }

    return applied;
  }

  private applyThinkingDuration(_messages: AgentMessage[]): boolean {
    // Log thinking duration for observability. No proto field exists for this;
    // adding one is a future enhancement (requires proto + UI changes).
    if (this.thinkingDurationMs !== undefined) {
      console.log(`DeltaEnricher: thinking completed in ${this.thinkingDurationMs}ms`);
      this.thinkingDurationMs = undefined;
      return true;
    }
    return false;
  }
}

function findToolCallById(messages: AgentMessage[], callId: string) {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const tc of messages[i].toolCalls) {
      if (tc.id === callId) return tc;
    }
  }
  return undefined;
}

/**
 * Extract displayable text from a shell-output-delta event payload.
 *
 * The Cursor SDK's shell-output-delta event carries a generic
 * Record<string, unknown>. Based on observed payloads, the structure is:
 *   { type: "stdout" | "stderr", data: string }
 * or sometimes:
 *   { output: string }
 *
 * This function handles both shapes defensively.
 */
function extractShellOutputText(event: Record<string, unknown>): string {
  if (typeof event.data === "string") return event.data;
  if (typeof event.output === "string") return event.output;
  if (typeof event.text === "string") return event.text;
  return "";
}

/**
 * Extract the tool call ID from a shell-output-delta event payload.
 *
 * The event may carry callId directly, or we may need to match by
 * context. Based on observed payloads:
 *   { callId: string, type: "stdout", data: string }
 */
function extractCallIdFromShellEvent(event: Record<string, unknown>): string | undefined {
  if (typeof event.callId === "string") return event.callId;
  if (typeof event.call_id === "string") return event.call_id;
  if (typeof event.id === "string") return event.id;
  return undefined;
}
