/**
 * SubAgentTracker — tracks sub-agent lifecycle and routes namespace-scoped
 * events to per-sub-agent message lists.
 *
 * Correlation strategy (derived from deepagents createSubagentTransformer):
 *   - Parent calls "task" tool → tool_started at root namespace ("") with callId
 *   - Sub-agent events arrive with namespace starting with "tools:<callId>"
 *   - First segment match (before "|") correlates events to the correct sub-agent
 *
 * The tracker owns the SubAgentExecution proto instances. V3StatusBuilder
 * delegates sub-agent-scoped events here instead of the parent message list.
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  SubAgentStatus,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { utcTimestamp } from "../../shared/status.js";
import { extractToolResultV3, MAX_TOOL_RESULT_CHARS } from "./status-builder-shared.js";
import type { StigmerRunEvent, V3UsagePayload } from "./v3-events.js";

// ── Per-SubAgent State ───────────────────────────────────────────────────────

interface SubAgentState {
  readonly proto: SubAgentExecution;
  readonly callId: string;
  readonly namespacePrefix: string;

  /** LLM runId → AgentMessage within this sub-agent's messages. */
  messagesByRun: Map<string, AgentMessage>;
  /** Namespace → current AI message for tool call attachment. */
  currentAiMessage: Map<string, AgentMessage>;
  /** Namespace → latest LLM runId for turn-boundary detection. */
  lastLlmRunId: Map<string, string>;
  /** ToolCallId → live ToolCall reference. */
  toolCalls: Map<string, ToolCall>;
  /** Progressive tool call arg accumulation. */
  toolArgBuffers: Map<string, string>;
}

// ── SubAgentTracker ──────────────────────────────────────────────────────────

export class SubAgentTracker {
  private readonly executions: SubAgentExecution[] = [];
  private readonly stateByCallId = new Map<string, SubAgentState>();
  private readonly stateByPrefix = new Map<string, SubAgentState>();

  /**
   * Called when a "task" tool_started event is observed at root namespace.
   * Creates a new SubAgentExecution and begins tracking.
   */
  onTaskToolStarted(callId: string, args: Record<string, unknown>): void {
    if (this.stateByCallId.has(callId)) return;

    const name = safeString(args, "subagent_type") || "task";
    const description = safeString(args, "description") || "";

    const proto = create(SubAgentExecutionSchema, {
      id: callId,
      name,
      subject: description,
      input: description,
      status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
      startedAt: utcTimestamp(),
    });

    const namespacePrefix = `tools:${callId}`;

    const state: SubAgentState = {
      proto,
      callId,
      namespacePrefix,
      messagesByRun: new Map(),
      currentAiMessage: new Map(),
      lastLlmRunId: new Map(),
      toolCalls: new Map(),
      toolArgBuffers: new Map(),
    };

    this.executions.push(proto);
    this.stateByCallId.set(callId, state);
    this.stateByPrefix.set(namespacePrefix, state);
  }

  /**
   * Called when the "task" tool finishes successfully.
   */
  onTaskToolFinished(callId: string, output: unknown): void {
    const state = this.stateByCallId.get(callId);
    if (!state) return;

    state.proto.status = SubAgentStatus.SUB_AGENT_COMPLETED;
    state.proto.completedAt = utcTimestamp();
    state.proto.output = extractToolResultV3(output);

    this.finalizeStreamingMessages(state);
  }

  /**
   * Called when the "task" tool errors.
   */
  onTaskToolError(callId: string, errorMessage: string): void {
    const state = this.stateByCallId.get(callId);
    if (!state) return;

    state.proto.status = SubAgentStatus.SUB_AGENT_FAILED;
    state.proto.completedAt = utcTimestamp();
    state.proto.error = errorMessage;

    this.finalizeStreamingMessages(state);
  }

  /**
   * Mark all active sub-agents as cancelled (parent execution cancelled).
   */
  cancelAll(): void {
    for (const state of this.stateByCallId.values()) {
      if (state.proto.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS) {
        state.proto.status = SubAgentStatus.SUB_AGENT_CANCELLED;
        state.proto.completedAt = utcTimestamp();
        state.proto.error = "Cancelled: parent execution was cancelled";
        this.finalizeStreamingMessages(state);
      }
    }
  }

  /**
   * Returns true if the given formatted namespace belongs to a tracked sub-agent.
   * A namespace belongs to a sub-agent if its first segment matches
   * "tools:<registeredCallId>".
   */
  isSubAgentNamespace(namespace: string): boolean {
    if (!namespace) return false;
    const firstSegment = extractFirstSegment(namespace);
    return this.stateByPrefix.has(firstSegment);
  }

  /**
   * Route a sub-agent-scoped event to the correct SubAgentExecution's messages.
   * The event has already been confirmed as sub-agent-scoped via isSubAgentNamespace.
   */
  routeEvent(event: StigmerRunEvent): void {
    const firstSegment = extractFirstSegment(event.namespace);
    const state = this.stateByPrefix.get(firstSegment);
    if (!state) return;

    // Resolve agent namespace: strip the sub-agent's graph segment AND any
    // tools:* segments from the remaining path. Within a sub-agent, all events
    // (from node "model_request", from "tools:callId", etc.) belong to the same
    // flat agent context — map them all to the canonical "" key.
    const localNs = this.resolveAgentNamespace(stripFirstSegment(event.namespace));

    switch (event.kind) {
      case "message_start":
        this.handleMessageStart(state, event.runId, localNs);
        break;
      case "text_delta":
        this.handleTextDelta(state, event.runId, localNs, event.text);
        break;
      case "reasoning_delta":
        this.handleReasoningDelta(state, event.runId, localNs, event.text);
        break;
      case "tool_call_arg_delta":
        this.handleToolCallArgDelta(state, event.callId, event.argsChunk);
        break;
      case "message_finish":
        this.handleMessageFinish(state, event.runId, event.usage);
        break;
      case "tool_started":
        this.handleToolStarted(state, event.callId, event.name, event.input, localNs);
        break;
      case "tool_finished":
        this.handleToolFinished(state, event.callId, event.output);
        break;
      case "tool_error":
        this.handleToolError(state, event.callId, event.message);
        break;
      case "tool_output_delta":
        this.handleToolOutputDelta(state, event.callId, event.delta);
        break;
      case "usage":
      case "lifecycle":
      case "provider":
        break;
    }
  }

  /**
   * Returns the current list of SubAgentExecution protos for persist.
   */
  getExecutions(): SubAgentExecution[] {
    return this.executions;
  }

  /**
   * Returns true if any sub-agents are being tracked.
   */
  hasExecutions(): boolean {
    return this.executions.length > 0;
  }

  // ── Message Handlers ─────────────────────────────────────────────────────

  private handleMessageStart(state: SubAgentState, runId: string, localNs: string): void {
    const lastRunId = state.lastLlmRunId.get(localNs);
    if (lastRunId && lastRunId !== runId) {
      const existingMsg = state.currentAiMessage.get(localNs);
      if (existingMsg) existingMsg.isStreaming = false;
    }
    state.lastLlmRunId.set(localNs, runId);
  }

  private handleTextDelta(state: SubAgentState, runId: string, localNs: string, text: string): void {
    const msg = this.ensureAiMessage(state, runId, localNs, MessageType.MESSAGE_AI);
    msg.content += text;
    msg.isStreaming = true;
  }

  private handleReasoningDelta(state: SubAgentState, runId: string, localNs: string, text: string): void {
    const thinkingKey = `thinking:${localNs}`;
    const existing = state.messagesByRun.get(thinkingKey);
    if (existing && existing.type === MessageType.MESSAGE_THINKING) {
      existing.content += text;
      existing.isStreaming = true;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_THINKING,
      content: text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });

    state.proto.messages.push(msg);
    state.messagesByRun.set(thinkingKey, msg);
  }

  private handleMessageFinish(state: SubAgentState, runId: string, usage?: V3UsagePayload): void {
    const msg = state.messagesByRun.get(runId);
    if (msg) msg.isStreaming = false;
    // Usage is tracked at parent level via V3StatusBuilder — not duplicated per sub-agent
    void usage;
  }

  // ── Tool Handlers ──────────────────────────────────────────────────────

  private handleToolStarted(
    state: SubAgentState,
    callId: string,
    name: string,
    input: Record<string, unknown>,
    localNs: string,
  ): void {
    const agentNs = this.resolveAgentNamespace(localNs);
    const parentMsg = state.currentAiMessage.get(agentNs)
      ?? this.ensureAiMessageForToolCall(state, agentNs);
    if (!parentMsg) return;

    const tc = create(ToolCallSchema, {
      id: callId,
      name,
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      startedAt: utcTimestamp(),
    });

    if (Object.keys(input).length > 0) {
      tc.args = input as JsonObject;
    }

    parentMsg.toolCalls.push(tc);
    state.toolCalls.set(callId, tc);
  }

  private handleToolFinished(state: SubAgentState, callId: string, output: unknown): void {
    const tc = state.toolCalls.get(callId);
    if (!tc) return;

    const result = extractToolResultV3(output);
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    tc.result = result.length > MAX_TOOL_RESULT_CHARS
      ? result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n[truncated: ${result.length} chars total]`
      : result;
    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
    state.toolArgBuffers.delete(callId);
  }

  private handleToolError(state: SubAgentState, callId: string, message: string): void {
    const tc = state.toolCalls.get(callId);
    if (!tc) return;

    tc.status = ToolCallStatus.TOOL_CALL_FAILED;
    tc.error = message;
    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
    state.toolArgBuffers.delete(callId);
  }

  private handleToolCallArgDelta(state: SubAgentState, callId: string, argsChunk: string): void {
    const tc = state.toolCalls.get(callId);
    if (!tc) return;

    const buffer = (state.toolArgBuffers.get(callId) ?? "") + argsChunk;
    state.toolArgBuffers.set(callId, buffer);

    try {
      tc.args = JSON.parse(buffer) as JsonObject;
    } catch {
      // Partial JSON — will resolve on next chunk or tool-finished
    }
  }

  private handleToolOutputDelta(state: SubAgentState, callId: string, delta: string): void {
    const tc = state.toolCalls.get(callId);
    if (!tc) return;
    tc.result = (tc.result ?? "") + delta;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private ensureAiMessage(
    state: SubAgentState,
    runId: string,
    localNs: string,
    type: MessageType,
  ): AgentMessage {
    const existing = state.messagesByRun.get(runId);
    if (existing) return existing;

    const lastRunId = state.lastLlmRunId.get(localNs);
    if (lastRunId && lastRunId !== runId) {
      const prev = state.currentAiMessage.get(localNs);
      if (prev) prev.isStreaming = false;
    }

    const msg = create(AgentMessageSchema, {
      type,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: true,
    });

    state.proto.messages.push(msg);
    state.messagesByRun.set(runId, msg);
    state.currentAiMessage.set(localNs, msg);
    state.lastLlmRunId.set(localNs, runId);

    return msg;
  }

  private ensureAiMessageForToolCall(state: SubAgentState, localNs: string): AgentMessage {
    const lastRunId = state.lastLlmRunId.get(localNs);
    if (lastRunId) {
      const existing = state.messagesByRun.get(lastRunId);
      if (existing) {
        state.currentAiMessage.set(localNs, existing);
        return existing;
      }
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: false,
    });

    state.proto.messages.push(msg);
    state.currentAiMessage.set(localNs, msg);
    return msg;
  }

  /**
   * Resolve a local namespace to an agent-level key.
   *
   * Within a sub-agent's flat execution context, internal namespace segments
   * (graph node names like "model_request", tool scopes like "tools:callId")
   * all belong to the same single agent. We collapse them to "" — the sub-agent
   * has only one conversation thread.
   */
  private resolveAgentNamespace(ns: string): string {
    if (!ns) return "";
    // Strip tools:* and known graph-node segments — sub-agents are flat
    const parts = ns.split("|").filter(p =>
      !p.startsWith("tools:") && !p.startsWith("model_request"),
    );
    return parts.join("|");
  }

  private finalizeStreamingMessages(state: SubAgentState): void {
    for (const msg of state.currentAiMessage.values()) {
      msg.isStreaming = false;
    }
  }
}

// ── Namespace Utilities ──────────────────────────────────────────────────────

/**
 * Extract the first segment from a pipe-separated namespace.
 * "tools:toolu_123|model_request:0" → "tools:toolu_123"
 */
function extractFirstSegment(namespace: string): string {
  const pipeIdx = namespace.indexOf("|");
  return pipeIdx === -1 ? namespace : namespace.slice(0, pipeIdx);
}

/**
 * Strip the first segment, returning everything after the first pipe.
 * "tools:toolu_123|model_request:0" → "model_request:0"
 * "tools:toolu_123" → ""
 */
function stripFirstSegment(namespace: string): string {
  const pipeIdx = namespace.indexOf("|");
  return pipeIdx === -1 ? "" : namespace.slice(pipeIdx + 1);
}

function safeString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  return typeof val === "string" ? val : "";
}
