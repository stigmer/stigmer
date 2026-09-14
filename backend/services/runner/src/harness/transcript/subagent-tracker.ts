/**
 * SubAgentTracker — tracks sub-agent lifecycle and routes namespace-scoped
 * events to per-sub-agent message lists.
 *
 * Correlation strategy (mirrors deepagents createSubagentTransformer):
 *   - Parent calls "task" tool → tool_started at depth 0 or 1
 *     (depth 1 in real runtime: namespace = ["tools:<pregelTaskUuid>"])
 *   - The task tool-started event's namespace segment becomes the routing prefix
 *   - Sub-agent child events arrive at depth >= 2, with the routing prefix as
 *     their first segment (e.g. "tools:<pregelUuid>|model_request:<innerUuid>")
 *   - First segment match (before "|") correlates child events to sub-agent
 *
 * The tracker builds INTO the status's own `subAgentExecutions` array, by
 * reference: it pushes new rows and mutates existing ones, never replaces the
 * array, so the caller that seeded the array from the persisted transcript
 * (the turn runtime's `seedFromPersistedStatus`) keeps every prior turn's
 * row and every wrapper of the status sees the same rows. Seeded rows are
 * indexed by id on construction; a re-emitted `task` tool start for a known
 * id binds its routing prefix to the existing row instead of pushing a twin
 * (the memory-checkpointer replay re-drives the whole graph), exactly as the
 * parent builder reconciles re-emitted tool calls through its rebuilt index.
 * Until S3 M2a the tracker owned a private array that `syncSubAgentExecutions`
 * assigned onto the status wholesale, which a resumed turn's first delegation
 * would have used to drop turn 1's rows (S3 M1 deferred debt).
 *
 * V3StatusBuilder delegates sub-agent-scoped events here instead of the
 * parent message list. Marking rows CANCELLED when a turn stops is NOT the
 * tracker's: `shared/subagent-rows.ts` `cancelInProgressSubAgentProtos` is
 * the one home of that transition for every harness (the runtime's thrown
 * arms and both adapters' stops call it); the tracker only clears the
 * streaming flags those rows' messages still carry
 * ({@link SubAgentTracker.finalizeAllStreaming}).
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
import { classifyTool } from "../../shared/tool-kind.js";
import { extractToolResultV3 } from "./tool-result.js";
import type { StigmerRunEvent } from "./events.js";

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

/** Fresh routing state over a row; `namespacePrefix` is `""` for a seeded row until its `task` start re-announces it. */
function newSubAgentState(proto: SubAgentExecution, callId: string, namespacePrefix: string): SubAgentState {
  return {
    proto,
    callId,
    namespacePrefix,
    messagesByRun: new Map(),
    currentAiMessage: new Map(),
    lastLlmRunId: new Map(),
    toolCalls: new Map(),
    toolArgBuffers: new Map(),
  };
}

// ── SubAgentTracker ──────────────────────────────────────────────────────────

export class SubAgentTracker {
  private readonly stateByCallId = new Map<string, SubAgentState>();
  private readonly stateByPrefix = new Map<string, SubAgentState>();

  /**
   * @param executions - The status's own `subAgentExecutions` array, built
   *   into by reference. Rows already on it (the runtime's seed on a
   *   reinvocation) are indexed by id, with their tool calls, so a re-driven
   *   event reconciles onto them; their routing prefix is unknown until a
   *   `task` tool start re-announces it.
   */
  constructor(private readonly executions: SubAgentExecution[]) {
    for (const proto of executions) {
      const state = newSubAgentState(proto, proto.id, "");
      for (const message of proto.messages) {
        for (const tc of message.toolCalls) {
          if (tc.id) state.toolCalls.set(tc.id, tc);
        }
      }
      this.stateByCallId.set(proto.id, state);
    }
  }

  /**
   * Called when a "task" tool_started event is observed at depth 0 or 1.
   * Creates a new SubAgentExecution and begins tracking — or, for a seeded
   * row re-announced by a replayed graph, binds the routing prefix to the
   * row that already exists.
   *
   * @param callId - Provider tool call ID (e.g. "toolu_01HW...")
   * @param args - Tool input arguments (subagent_type, description)
   * @param routingPrefix - The namespace segment used to match child events.
   *   At depth 1 this is the event's own namespace (the LangGraph tools-node
   *   segment, e.g. "tools:<pregelUuid>"). At depth 0 (edge case / tests) the
   *   caller provides a synthetic prefix like "tools:<callId>".
   */
  onTaskToolStarted(callId: string, args: Record<string, unknown>, routingPrefix: string): void {
    const existing = this.stateByCallId.get(callId);
    if (existing) {
      if (existing.namespacePrefix === "") {
        const bound = { ...existing, namespacePrefix: routingPrefix };
        this.stateByCallId.set(callId, bound);
        this.stateByPrefix.set(routingPrefix, bound);
      }
      return;
    }

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

    const state = newSubAgentState(proto, callId, routingPrefix);

    this.executions.push(proto);
    this.stateByCallId.set(callId, state);
    this.stateByPrefix.set(routingPrefix, state);
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
   * Clear the streaming flag on every tracked sub-agent's in-flight
   * messages. Called when the turn stops before the sub-agents finished;
   * the rows' own CANCELLED transition is the caller's, through the shared
   * `cancelInProgressSubAgentProtos` (see the header).
   */
  finalizeAllStreaming(): void {
    for (const state of this.stateByCallId.values()) {
      this.finalizeStreamingMessages(state);
    }
  }

  /**
   * Returns true if the given formatted namespace belongs to a tracked sub-agent.
   *
   * Only matches events at depth >= 2 (namespace contains a pipe separator).
   * Depth-1 events share the same first segment as registered prefixes but are
   * parent-level tool lifecycle events (handled separately by isTrackedTaskTool).
   * Child events have the registered prefix as their first segment PLUS additional
   * inner segments (e.g. "tools:<pregelUuid>|model_request:<innerUuid>").
   */
  isSubAgentNamespace(namespace: string): boolean {
    if (!namespace || !namespace.includes("|")) return false;
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
        this.handleMessageFinish(state, event.runId);
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

  private handleMessageFinish(state: SubAgentState, runId: string): void {
    const msg = state.messagesByRun.get(runId);
    if (msg) msg.isStreaming = false;
    // The usage on this event was reported by `V3StatusBuilder.processEvent`
    // before it routed here (Q-M2b-1); the tracker owns the transcript only.
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
      toolKind: classifyTool(name),
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

    // Faithful result only; payload size is bounded at the persist chokepoint
    // (see v3 builder note). Truncating here would corrupt image base64.
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    tc.result = extractToolResultV3(output);
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
