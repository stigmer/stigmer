/**
 * LangGraph event-to-proto mapper for ExecuteDeepAgent streaming.
 *
 * Processes streamEvents v2 events and progressively builds the
 * AgentExecutionStatus proto. Each handler method is a focused unit
 * testable in isolation.
 *
 * Phase 3b-i scope: main-agent events only (no sub-agent routing,
 * no HITL approval, no tool input streaming). Those are added in
 * Phases 3b-ii and 3c.
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { RunnerUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type { RunnerUsageSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { ExecutionState } from "./execution-state.js";
import { utcTimestamp } from "../../shared/status.js";

/** Minimal LangGraph streamEvents v2 event shape. */
export interface StreamEvent {
  readonly event: string;
  readonly name?: string;
  readonly run_id: string;
  readonly data: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly parent_ids?: readonly string[];
}

type EventHandler = (event: StreamEvent, namespace: string) => void;

const MAX_TOOL_RESULT_CHARS = 50_000;

export class StatusBuilder {
  readonly executionId: string;
  private readonly state: ExecutionState;
  private _forceNextUpdate = false;

  private readonly usageAccumulator: UsageAccumulator;
  private readonly handlers: ReadonlyMap<string, EventHandler>;

  constructor(executionId: string, initialStatus: AgentExecutionStatus) {
    this.executionId = executionId;
    this.state = new ExecutionState(initialStatus);

    initialStatus.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
    if (!initialStatus.startedAt) {
      initialStatus.startedAt = utcTimestamp();
    }

    this.usageAccumulator = new UsageAccumulator();

    this.handlers = new Map<string, EventHandler>([
      ["on_chat_model_stream", this.handleChatModelStream.bind(this)],
      ["on_chat_model_end", this.handleChatModelEnd.bind(this)],
      ["on_tool_start", this.handleToolStart.bind(this)],
      ["on_tool_end", this.handleToolEnd.bind(this)],
    ]);
  }

  get currentStatus(): AgentExecutionStatus {
    return this.state.proto;
  }

  get forceNextUpdate(): boolean {
    return this._forceNextUpdate;
  }

  clearForceFlag(): void {
    this._forceNextUpdate = false;
  }

  /**
   * Process a single streamEvents v2 event.
   * Unknown event types are silently ignored.
   */
  processEvent(event: StreamEvent): void {
    const namespace = this.extractNamespace(event);
    const handler = this.handlers.get(event.event);
    if (!handler) return;

    try {
      handler(event, namespace);
    } catch (err) {
      console.error(
        `[StatusBuilder] Event handler error: execution=${this.executionId} ` +
        `event=${event.event} run_id=${event.run_id}: ${err}`,
      );
    }
  }

  // ── Event Handlers ─────────────────────────────────────────────────

  private handleChatModelStream(event: StreamEvent, namespace: string): void {
    const chunk = event.data?.chunk as Record<string, unknown> | undefined;
    if (!chunk) return;

    const content = chunk.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === "thinking" && typeof b.thinking === "string") {
            this.appendThinkingContent(event.run_id, namespace, b.thinking);
          } else if (b.type === "text" && typeof b.text === "string") {
            this.appendTextContent(event.run_id, namespace, b.text);
          }
        }
      }
    } else if (typeof content === "string" && content.length > 0) {
      this.appendTextContent(event.run_id, namespace, content);
    }
  }

  private handleChatModelEnd(event: StreamEvent, namespace: string): void {
    const output = event.data?.output as Record<string, unknown> | undefined;

    const msg = this.state.messagesByRun.get(event.run_id);
    if (msg) {
      msg.isStreaming = false;
    }

    const usageMeta = (output?.usage_metadata ?? event.data?.usage_metadata) as
      Record<string, unknown> | undefined;
    if (usageMeta) {
      this.usageAccumulator.accumulate(usageMeta);
      this.syncUsageToProto();
    }
  }

  private handleToolStart(event: StreamEvent, namespace: string): void {
    const parentMsg = this.state.currentAiMessage.get(namespace);
    if (!parentMsg) return;

    const toolName = event.name ?? "unknown_tool";
    const rawArgs = event.data?.input as Record<string, unknown> | undefined;

    const tc = create(ToolCallSchema, {
      id: event.run_id,
      name: toolName,
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      startedAt: utcTimestamp(),
    });

    if (rawArgs) {
      tc.args = rawArgs as JsonObject;
    }

    parentMsg.toolCalls.push(tc);
    this.state.toolCalls.set(event.run_id, tc);
    this.state.toolStartTimes.set(event.run_id, performance.now());

    this._forceNextUpdate = true;
  }

  private handleToolEnd(event: StreamEvent, _namespace: string): void {
    const tc = this.state.toolCalls.get(event.run_id);
    if (!tc) return;

    const output = event.data?.output as Record<string, unknown> | undefined;
    const errorMsg = output?.error as string | undefined;

    if (errorMsg) {
      tc.status = ToolCallStatus.TOOL_CALL_FAILED;
      tc.error = errorMsg;
    } else {
      tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
      const result = extractToolResult(event.data);
      tc.result = result.length > MAX_TOOL_RESULT_CHARS
        ? result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n[truncated: ${result.length} chars total]`
        : result;
    }

    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
    this.state.toolStartTimes.delete(event.run_id);

    this._forceNextUpdate = true;
  }

  // ── Content Helpers ────────────────────────────────────────────────

  private appendTextContent(runId: string, namespace: string, text: string): void {
    const msg = this.ensureAiMessage(runId, namespace, MessageType.MESSAGE_AI);
    msg.content += text;
    msg.isStreaming = true;
  }

  private appendThinkingContent(runId: string, namespace: string, text: string): void {
    const thinkingKey = `thinking:${namespace}`;
    const existingMsg = this.state.messagesByRun.get(thinkingKey);
    if (existingMsg && existingMsg.type === MessageType.MESSAGE_THINKING) {
      existingMsg.content += text;
      existingMsg.isStreaming = true;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_THINKING,
      content: text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });
    this.state.proto.messages.push(msg);
    this.state.messagesByRun.set(thinkingKey, msg);
  }

  /**
   * Get or create the AI message for a given LLM run. A new message is
   * created when the run_id changes (turn boundary) to prevent token
   * interleaving.
   */
  private ensureAiMessage(
    runId: string,
    namespace: string,
    type: MessageType,
  ): AgentMessage {
    const existingByRun = this.state.messagesByRun.get(runId);
    if (existingByRun) return existingByRun;

    const lastRunId = this.state.lastLlmRunId.get(namespace);
    if (lastRunId && lastRunId !== runId) {
      const existingMsg = this.state.currentAiMessage.get(namespace);
      if (existingMsg) {
        existingMsg.isStreaming = false;
      }
    }

    const msg = create(AgentMessageSchema, {
      type,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: true,
    });

    this.state.proto.messages.push(msg);
    this.state.messagesByRun.set(runId, msg);
    this.state.currentAiMessage.set(namespace, msg);
    this.state.lastLlmRunId.set(namespace, runId);

    return msg;
  }

  private extractNamespace(event: StreamEvent): string {
    const meta = event.metadata;
    if (!meta) return "";
    const ns = (meta.langgraph_checkpoint_ns ?? meta.checkpoint_ns ?? "") as string;
    return typeof ns === "string" ? ns : "";
  }

  private syncUsageToProto(): void {
    const snapshot = this.usageAccumulator.snapshot();
    this.state.proto.runnerUsage = create(RunnerUsageSummarySchema, snapshot);
  }
}

// ── Usage Accumulator ──────────────────────────────────────────────

interface UsageSnapshot {
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
  totalTokens: bigint;
  turnCount: number;
  observedAt: string;
}

class UsageAccumulator {
  private inputTokens = 0n;
  private outputTokens = 0n;
  private cacheReadTokens = 0n;
  private cacheWriteTokens = 0n;
  private turnCount = 0;
  private lastObservedAt = "";

  accumulate(meta: Record<string, unknown>): void {
    this.inputTokens += toBigInt(meta.input_tokens);
    this.outputTokens += toBigInt(meta.output_tokens);
    this.cacheReadTokens += toBigInt(meta.cache_read_input_tokens);
    this.cacheWriteTokens += toBigInt(meta.cache_creation_input_tokens);
    this.turnCount++;
    this.lastObservedAt = utcTimestamp();
  }

  snapshot(): UsageSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      totalTokens: this.inputTokens + this.outputTokens +
        this.cacheReadTokens + this.cacheWriteTokens,
      turnCount: this.turnCount,
      observedAt: this.lastObservedAt,
    };
  }
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  return 0n;
}

function extractToolResult(data: Record<string, unknown>): string {
  const output = data.output;
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const content = (output as Record<string, unknown>).content;
    if (typeof content === "string") return content;
  }
  try {
    return JSON.stringify(output ?? data);
  } catch {
    return "[serialization error]";
  }
}
