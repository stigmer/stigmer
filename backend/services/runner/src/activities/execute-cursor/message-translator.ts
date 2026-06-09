/**
 * Translates Cursor SDK streaming events into Stigmer AgentMessage protos.
 *
 * The Cursor SDK emits SDKMessage events during a Run. This module provides
 * both stateless translation (translateEvent) and stateful accumulation
 * (MessageAccumulator) for building coherent messages from token-level
 * streaming events.
 *
 * The Cursor SDK emits one SDKAssistantMessage per token chunk — a single
 * LLM turn produces dozens of events. MessageAccumulator merges them into
 * a single AgentMessage per turn, matching the Python agent-runner's
 * proven pattern (see chat_model.py handle_chat_model_stream).
 *
 * Tool calls are attached to the most recent MESSAGE_AI message rather
 * than emitted as standalone MESSAGE_TOOL messages. This matches:
 *   - The proto model (AgentMessage.tool_calls repeated field)
 *   - The Python agent-runner's StatusBuilder pattern
 *   - The UI's MessageThread expectation (tool calls on AI messages)
 *
 * Task (sub-agent) tool calls additionally produce SubAgentExecution
 * protos accessible via MessageAccumulator.subAgentExecutions.
 *
 * MCP tool enrichment:
 * Cursor reports MCP tool calls with name="mcp" and the actual details
 * (providerIdentifier, toolName, args) inside event.args. This module
 * extracts those details to populate the ToolCall proto with:
 * - name: the actual MCP tool name (e.g., "search_services")
 * - mcpServerSlug: the MCP server identifier (e.g., "planton")
 * - requiresApproval: from the merged policy chain
 * - approvalMessage: from the policy, with placeholder resolution
 */

import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { MessageType, ToolCallStatus, SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import type { MergedToolPolicy } from "./approval-policy.js";
import { lookupMcpToolPolicy, resolveApprovalMessage, builtInRequiresApproval, getBuiltInApprovalMessage } from "./approval-policy.js";
import { grantToken, toolIdentity, type DeniedLedgerEntry } from "./approval-state.js";
import { utcTimestamp } from "../../shared/status.js";
import { classifyTool } from "../../shared/tool-kind.js";

export { utcTimestamp };

const SUPPRESSED_TOOL_NAMES = new Set(["TodoWrite", "updateTodos"]);

/**
 * Details extracted from an MCP tool call event's args.
 *
 * When Cursor invokes an MCP tool, the SDK stream reports event.name as
 * "mcp" and packs the real tool identity into event.args:
 * { providerIdentifier: "planton", toolName: "search_services", args: {...} }
 */
export interface McpToolDetails {
  providerIdentifier: string;
  toolName: string;
  innerArgs: Record<string, unknown>;
}

/**
 * Try to extract MCP tool details from a tool_call event.
 * Returns undefined if the event is not an MCP tool call.
 */
export function extractMcpToolDetails(
  event: Extract<SDKMessage, { type: "tool_call" }>,
): McpToolDetails | undefined {
  if (event.name !== "mcp") return undefined;

  const args = event.args;
  if (args == null || typeof args !== "object") return undefined;

  const obj = args as Record<string, unknown>;
  const providerIdentifier = typeof obj.providerIdentifier === "string" ? obj.providerIdentifier : "";
  const toolName = typeof obj.toolName === "string" ? obj.toolName : "";

  if (!toolName) return undefined;

  const innerArgs = (typeof obj.args === "object" && obj.args !== null)
    ? obj.args as Record<string, unknown>
    : {};

  return { providerIdentifier, toolName, innerArgs };
}

/**
 * Translate a single Cursor SDKMessage into zero or more Stigmer AgentMessages.
 *
 * Most events produce exactly one message. Some (like system init) are
 * informational and produce none.
 *
 * Note: for production streaming, use MessageAccumulator instead — it
 * merges token-level events and attaches tool calls to their parent AI
 * messages. This stateless function is retained for unit testing and
 * simple single-event translation.
 */
export function translateEvent(event: SDKMessage): AgentMessage[] {
  switch (event.type) {
    case "assistant":
      return [translateAssistant(event)];
    case "thinking":
      return [translateThinking(event)];
    case "tool_call":
      return [translateToolCall(event)];
    case "task":
      return event.text ? [translateTask(event)] : [];
    case "system":
    case "status":
    case "user":
    case "request":
      return [];
    default:
      return [];
  }
}

function translateAssistant(event: Extract<SDKMessage, { type: "assistant" }>): AgentMessage {
  const textBlocks = event.message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text);

  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: textBlocks.join(""),
    timestamp: utcTimestamp(),
  });
}

function translateThinking(event: Extract<SDKMessage, { type: "thinking" }>): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_THINKING,
    content: event.text,
    timestamp: utcTimestamp(),
  });
}

/**
 * Stateless translation of a tool_call event into a standalone MESSAGE_TOOL
 * message. Retained for backward compatibility with translateEvent() and
 * tests that use the stateless API.
 */
function translateToolCall(event: Extract<SDKMessage, { type: "tool_call" }>): AgentMessage {
  const toolCall = buildToolCallProto(event);
  const displayName = toolCall.mcpServerSlug
    ? `${toolCall.mcpServerSlug}/${toolCall.name}`
    : toolCall.name;
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_TOOL,
    content: `Tool: ${displayName} [${event.status}]`,
    timestamp: utcTimestamp(),
    toolCalls: [toolCall],
  });
}

/**
 * Build a ToolCall proto from a Cursor SDK tool_call event.
 *
 * For MCP tools (event.name === "mcp"), extracts the actual tool name
 * and server slug from event.args. For built-in tools, uses the event
 * name directly.
 *
 * Approval fields are populated when mergedPolicies are provided.
 * Without policies, only basic fields are set (backward compatible).
 */
export function buildToolCallProto(
  event: Extract<SDKMessage, { type: "tool_call" }>,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): ToolCall {
  const status = mapToolCallStatus(event.status);
  const mcpDetails = extractMcpToolDetails(event);

  const actualName = mcpDetails?.toolName ?? event.name;
  const mcpServerSlug = mcpDetails?.providerIdentifier ?? "";

  const toolCall = create(ToolCallSchema, {
    id: event.call_id,
    name: actualName,
    status,
    startedAt: status === ToolCallStatus.TOOL_CALL_RUNNING ? utcTimestamp() : "",
    completedAt: isTerminalToolStatus(status) ? utcTimestamp() : "",
    result: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? ""),
    error: status === ToolCallStatus.TOOL_CALL_FAILED
      ? (typeof event.result === "string" ? event.result : "Tool call failed")
      : "",
    mcpServerSlug,
    toolKind: classifyTool(actualName, mcpServerSlug),
  });

  if (event.args != null) {
    toolCall.argsPreview = typeof event.args === "string"
      ? event.args
      : JSON.stringify(event.args);
  }

  const argsObj = mcpDetails?.innerArgs ?? (
    typeof event.args === "object" && event.args !== null
      ? event.args as Record<string, unknown>
      : undefined
  );
  if (argsObj && typeof argsObj === "object") {
    toolCall.args = argsObj as import("@bufbuild/protobuf").JsonObject;
  }

  // Populate approval fields from the merged policy chain
  if (mergedPolicies && mcpDetails) {
    const policy = lookupMcpToolPolicy(actualName, mcpServerSlug, mergedPolicies);
    if (policy) {
      toolCall.requiresApproval = true;
      toolCall.approvalMessage = resolveApprovalMessage(
        policy.approvalMessage,
        actualName,
        mcpDetails.innerArgs,
      );
      if (status === ToolCallStatus.TOOL_CALL_FAILED) {
        toolCall.approvalRequestedAt = utcTimestamp();
      }
    }
  } else if (mergedPolicies && !mcpDetails) {
    const requires = builtInRequiresApproval(actualName);
    toolCall.requiresApproval = requires;
    if (requires) {
      const template = getBuiltInApprovalMessage(actualName);
      if (template) {
        toolCall.approvalMessage = resolveApprovalMessage(template, actualName, argsObj ?? {});
        if (status === ToolCallStatus.TOOL_CALL_FAILED) {
          toolCall.approvalRequestedAt = utcTimestamp();
        }
      }
    }
  }

  return toolCall;
}

function translateTask(event: Extract<SDKMessage, { type: "task" }>): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: event.text ?? "",
    timestamp: utcTimestamp(),
  });
}

function mapToolCallStatus(cursorStatus: string): ToolCallStatus {
  switch (cursorStatus) {
    case "running":
      return ToolCallStatus.TOOL_CALL_RUNNING;
    case "completed":
      return ToolCallStatus.TOOL_CALL_COMPLETED;
    case "error":
      return ToolCallStatus.TOOL_CALL_FAILED;
    default:
      return ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED;
  }
}

function mapSubAgentStatus(cursorStatus: string): SubAgentStatus {
  switch (cursorStatus) {
    case "running":
      return SubAgentStatus.SUB_AGENT_IN_PROGRESS;
    case "completed":
      return SubAgentStatus.SUB_AGENT_COMPLETED;
    case "error":
      return SubAgentStatus.SUB_AGENT_FAILED;
    default:
      return SubAgentStatus.SUB_AGENT_PENDING;
  }
}

function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return (
    status === ToolCallStatus.TOOL_CALL_COMPLETED ||
    status === ToolCallStatus.TOOL_CALL_FAILED ||
    status === ToolCallStatus.TOOL_CALL_SKIPPED
  );
}

/**
 * Extract sub-agent name from task tool args, handling both the
 * legacy string format (`"generalPurpose"`) and the current SDK
 * object format (`{ kind: "generalPurpose", name?: "..." }`).
 *
 * Falls back to `description` (always populated by the SDK) before
 * returning the generic `"task"`. The `kind` value `"unspecified"`
 * is treated as absent since the Cursor SDK uses it as a default
 * when the sub-agent type is not specified in the blueprint.
 */
function extractSubagentName(args: unknown): string {
  if (args == null || typeof args !== "object") return "task";
  const obj = args as Record<string, unknown>;

  const subagentType = obj.subagentType ?? obj.subagent_type;
  if (typeof subagentType === "string" && subagentType) return subagentType;
  if (subagentType != null && typeof subagentType === "object") {
    const typed = subagentType as Record<string, unknown>;
    if (typeof typed.name === "string" && typed.name) return typed.name;
    if (typeof typed.kind === "string" && typed.kind && typed.kind !== "unspecified") {
      return typed.kind;
    }
  }

  if (typeof obj.description === "string" && obj.description) return obj.description;

  return "task";
}

function safeString(obj: unknown, key: string): string {
  if (obj != null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "string" ? val : "";
  }
  return "";
}

/**
 * Normalize a tool_call event result into a string for the ToolCall proto.
 * Returns "" for an absent result so callers can treat "no result yet" and
 * "empty result" uniformly (e.g. to avoid clobbering a captured result).
 */
function toResultString(result: unknown): string {
  if (result == null) return "";
  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * Parse the task tool's completed result into AgentMessages.
 *
 * The Cursor SDK returns sub-agent work as a blob in the task tool's
 * completed event (not as streaming events with a distinct agent_id).
 * The result shape is:
 *
 *   { status: "success", value: { conversationSteps: ConversationStep[] } }
 *
 * where ConversationStep is a discriminated union:
 *   - { type: "thinkingMessage", message: { text, thinkingDurationMs? } }
 *   - { type: "assistantMessage", message: { text } }
 *   - { type: "toolCall", message: { type, args, result?, ... } }
 *
 * This function defensively parses whatever steps are present and
 * appends corresponding AgentMessage protos to the output array.
 * Unknown step types are silently skipped for forward compatibility.
 */
export function extractConversationSteps(
  result: unknown,
  out: AgentMessage[],
): void {
  if (result == null || typeof result !== "object") return;
  const r = result as Record<string, unknown>;

  const value = r.value ?? r;
  if (value == null || typeof value !== "object") return;
  const v = value as Record<string, unknown>;

  const steps = v.conversationSteps;
  if (!Array.isArray(steps)) return;

  for (const step of steps) {
    if (step == null || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const type = s.type as string | undefined;

    if (type === "thinkingMessage" || s.thinkingMessage != null) {
      const msg = (type === "thinkingMessage" ? s.message : s.thinkingMessage) as Record<string, unknown> | undefined;
      const text = typeof msg?.text === "string" ? msg.text : "";
      if (text) {
        out.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_THINKING,
          content: text,
          timestamp: utcTimestamp(),
        }));
      }
    } else if (type === "assistantMessage" || s.assistantMessage != null) {
      const msg = (type === "assistantMessage" ? s.message : s.assistantMessage) as Record<string, unknown> | undefined;
      const text = typeof msg?.text === "string" ? msg.text : "";
      if (text) {
        out.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: text,
          timestamp: utcTimestamp(),
        }));
      }
    } else if (type === "toolCall") {
      const msg = s.message as Record<string, unknown> | undefined;
      if (msg) {
        const toolName = typeof msg.type === "string" ? msg.type : "unknown";
        const toolArgs = msg.args != null ? JSON.stringify(msg.args) : "";
        let toolResult = "";
        if (msg.result != null) {
          const resultObj = msg.result as Record<string, unknown>;
          if (resultObj.status === "success" && resultObj.value != null) {
            toolResult = typeof resultObj.value === "string"
              ? resultObj.value
              : JSON.stringify(resultObj.value);
          } else if (resultObj.status === "error") {
            toolResult = typeof resultObj.error === "string"
              ? resultObj.error
              : JSON.stringify(resultObj);
          } else {
            toolResult = JSON.stringify(msg.result);
          }
        }

        const aiMsg = create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: "",
          timestamp: utcTimestamp(),
          toolCalls: [create(ToolCallSchema, {
            id: `sub-${toolName}-${out.length}`,
            name: toolName,
            status: ToolCallStatus.TOOL_CALL_COMPLETED,
            argsPreview: toolArgs,
            result: toolResult,
            startedAt: utcTimestamp(),
            completedAt: utcTimestamp(),
            toolKind: classifyTool(toolName),
          })],
        });
        out.push(aiMsg);
      }
    }
  }
}

/**
 * Options for creating a MessageAccumulator with policy awareness.
 */
export interface MessageAccumulatorOptions {
  mergedPolicies?: Map<string, MergedToolPolicy>;
}

/**
 * Stateful accumulator that merges per-token SDK events into coherent
 * AgentMessages.
 *
 * The Cursor SDK emits one `assistant` event per token chunk (validated:
 * a 2-sentence response produces ~41 events). Without accumulation each
 * chunk becomes a separate AgentMessage, causing the UI to render each
 * word on its own line.
 *
 * MessageAccumulator tracks the active AI and thinking messages per
 * run_id. Consecutive assistant events for the same run_id append to
 * the existing message's content instead of creating new ones.
 *
 * Tool calls are attached to the most recent MESSAGE_AI message's
 * toolCalls array — matching the Python agent-runner's StatusBuilder
 * pattern and the UI's MessageThread expectations.
 *
 * Tool call lifecycle is tracked via a `toolCallIndex` map (keyed by
 * call_id), mirroring the native harness's `ExecutionState.toolCalls`.
 * This ensures completion events always find the correct ToolCall proto
 * regardless of which AI message it was originally attached to — the
 * index stores the same object reference that lives in the message's
 * `toolCalls[]` array, so mutations propagate directly to the proto.
 *
 * Task (sub-agent) tool calls additionally produce SubAgentExecution
 * protos, accessible via the subAgentExecutions getter.
 */
/**
 * Transition any non-terminal sub-agent (IN_PROGRESS or PENDING) in the given
 * proto array to CANCELLED with a completion timestamp, in place.
 *
 * Operates directly on the status array (not the accumulator) because the
 * Cursor cancellation exception unwinds out of the streaming loop into the
 * activity's catch block, where the MessageAccumulator is out of scope. Returns
 * true if any sub-agent changed.
 */
export function cancelInProgressSubAgentProtos(
  subAgents: SubAgentExecution[],
): boolean {
  let changed = false;
  for (const sub of subAgents) {
    if (
      sub.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS ||
      sub.status === SubAgentStatus.SUB_AGENT_PENDING
    ) {
      sub.status = SubAgentStatus.SUB_AGENT_CANCELLED;
      sub.completedAt = utcTimestamp();
      changed = true;
    }
  }
  return changed;
}

export class MessageAccumulator {
  private readonly messages: AgentMessage[];
  private activeAiByRunId = new Map<string, AgentMessage>();
  private activeThinkingByRunId = new Map<string, AgentMessage>();
  private readonly _subAgentExecutions: SubAgentExecution[] = [];
  private readonly subAgentMap = new Map<string, SubAgentExecution>();
  private readonly mergedPolicies?: Map<string, MergedToolPolicy>;
  private readonly toolCallIndex = new Map<string, ToolCall>();
  private _subAgentDirty = false;

  constructor(messages: AgentMessage[], options?: MessageAccumulatorOptions) {
    this.messages = messages;
    this.mergedPolicies = options?.mergedPolicies;
  }

  get subAgentExecutions(): SubAgentExecution[] {
    return this._subAgentExecutions;
  }

  /**
   * True when a sub-agent execution has been created or updated since the last
   * markSubAgentPersisted(). The streaming loop uses this to trigger a persist
   * promptly when delegation begins (the "task" running event), so the live UI
   * surfaces the sub-agent's IN_PROGRESS state instead of showing no activity
   * until the parent finalizes.
   */
  get subAgentDirty(): boolean {
    return this._subAgentDirty;
  }

  /** Clears the sub-agent dirty flag after the latest status has been persisted. */
  markSubAgentPersisted(): void {
    this._subAgentDirty = false;
  }

  /**
   * Transition any non-terminal sub-agent (IN_PROGRESS or PENDING) to CANCELLED.
   *
   * Called when the parent run is aborted (pause / cancel / worker shutdown):
   * the Cursor SDK run stops, so a delegated sub-agent is no longer executing.
   * Without this, the final snapshot would show a permanent "Running" zombie
   * sub-agent. Mirrors the native harness's cancelSubAgents().
   */
  cancelInProgressSubAgents(): void {
    if (cancelInProgressSubAgentProtos(this._subAgentExecutions)) {
      this._subAgentDirty = true;
    }
  }

  processEvent(event: SDKMessage): void {
    switch (event.type) {
      case "assistant":
        this.accumulateAssistant(event);
        break;
      case "thinking":
        this.accumulateThinking(event);
        break;
      case "tool_call":
        this.finalizeStreaming(event.run_id);
        this.attachToolCallToLastAi(event);
        break;
      case "task":
        if (event.text) {
          this.messages.push(translateTask(event));
        }
        break;
    }
  }

  finalize(): void {
    for (const msg of this.activeAiByRunId.values()) {
      msg.isStreaming = false;
    }
    for (const msg of this.activeThinkingByRunId.values()) {
      msg.isStreaming = false;
    }
    this.activeAiByRunId.clear();
    this.activeThinkingByRunId.clear();
  }

  /**
   * Attach a tool call to the current AI message, upserting by `call_id` so a
   * single call maps to at most ONE ToolCall across all messages.
   *
   * The Cursor SDK can emit the lifecycle for one `call_id` more than once —
   * observed in production as two "running" events ~0.5s apart for task/edit
   * tools, which previously appended a duplicate ToolCall (the same call
   * rendered two or three times in the UI). We therefore index by `call_id`
   * and merge subsequent events into the existing proto, mirroring how
   * trackSubAgentExecution() upserts via subAgentMap. The first event for a
   * `call_id` (running or terminal) creates the proto on the last AI message;
   * the index keeps pointing at it even after later assistant text starts a
   * new AI message, so cross-message completions still land on the original.
   */
  private attachToolCallToLastAi(
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): void {
    if (SUPPRESSED_TOOL_NAMES.has(event.name)) return;

    const existing = this.toolCallIndex.get(event.call_id);
    if (!existing) {
      const tc = buildToolCallProto(event, this.mergedPolicies);
      this.findOrCreateLastAiMessage().toolCalls.push(tc);
      this.toolCallIndex.set(event.call_id, tc);
      return;
    }

    this.mergeToolCallEvent(existing, event);
  }

  /**
   * Merge a repeated tool_call event into the ToolCall already tracked for this
   * `call_id`. The merge is defensive because a re-emitted event may carry less
   * information than an earlier one (a late "running" after "completed", or a
   * completion with an empty result): status only advances toward terminal,
   * timestamps are stamped once, and a populated result/args is never clobbered
   * by an empty one.
   */
  private mergeToolCallEvent(
    existing: ToolCall,
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): void {
    const status = mapToolCallStatus(event.status);

    // Status advances monotonically: once terminal (completed/failed/skipped)
    // a later "running" re-emit must not regress it back to RUNNING.
    if (!isTerminalToolStatus(existing.status)) {
      existing.status = status;
    }
    if (isTerminalToolStatus(status) && !existing.completedAt) {
      existing.completedAt = utcTimestamp();
    }
    if (!existing.startedAt && status === ToolCallStatus.TOOL_CALL_RUNNING) {
      existing.startedAt = utcTimestamp();
    }

    // Only a non-empty incoming result overwrites; a result-less "running"
    // re-emit must not wipe a result captured on completion (or vice versa).
    const incomingResult = toResultString(event.result);
    if (incomingResult) {
      existing.result = incomingResult;
    }

    if (status === ToolCallStatus.TOOL_CALL_FAILED) {
      if (!existing.error) {
        existing.error = typeof event.result === "string"
          ? event.result
          : "Tool call failed";
      }
      if (existing.requiresApproval && !existing.approvalRequestedAt) {
        existing.approvalRequestedAt = utcTimestamp();
      }
    }

    if (event.args != null && !existing.argsPreview) {
      existing.argsPreview = typeof event.args === "string"
        ? event.args
        : JSON.stringify(event.args);
    }
  }

  private findOrCreateLastAiMessage(): AgentMessage {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === MessageType.MESSAGE_AI) {
        return this.messages[i];
      }
    }
    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
    });
    this.messages.push(msg);
    return msg;
  }

  trackSubAgentExecution(
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): SubAgentExecution | undefined {
    const existing = this.subAgentMap.get(event.call_id);

    if (existing) {
      existing.status = mapSubAgentStatus(event.status);
      if (event.status === "completed" || event.status === "error") {
        existing.completedAt = utcTimestamp();
      }
      if (event.status === "completed" && event.result != null) {
        existing.output = typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result);
        extractConversationSteps(event.result, existing.messages);
      }
      if (event.status === "error") {
        existing.error = typeof event.result === "string"
          ? event.result
          : "Sub-agent failed";
      }
      this._subAgentDirty = true;
      return existing;
    }

    const sub = create(SubAgentExecutionSchema, {
      id: event.call_id,
      name: extractSubagentName(event.args),
      subject: safeString(event.args, "description"),
      input: safeString(event.args, "prompt"),
      status: mapSubAgentStatus(event.status),
      startedAt: utcTimestamp(),
    });
    this._subAgentExecutions.push(sub);
    this.subAgentMap.set(event.call_id, sub);
    this._subAgentDirty = true;
    return sub;
  }

  private accumulateAssistant(
    event: Extract<SDKMessage, { type: "assistant" }>,
  ): void {
    const text = event.message.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text) return;

    const existing = this.activeAiByRunId.get(event.run_id);
    if (existing) {
      existing.content += text;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });
    this.messages.push(msg);
    this.activeAiByRunId.set(event.run_id, msg);
  }

  private accumulateThinking(
    event: Extract<SDKMessage, { type: "thinking" }>,
  ): void {
    if (!event.text) return;

    const existing = this.activeThinkingByRunId.get(event.run_id);
    if (existing) {
      existing.content += event.text;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_THINKING,
      content: event.text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });
    this.messages.push(msg);
    this.activeThinkingByRunId.set(event.run_id, msg);
  }

  private finalizeStreaming(runId: string): void {
    const ai = this.activeAiByRunId.get(runId);
    if (ai) {
      ai.isStreaming = false;
      this.activeAiByRunId.delete(runId);
    }
    const thinking = this.activeThinkingByRunId.get(runId);
    if (thinking) {
      thinking.isStreaming = false;
      this.activeThinkingByRunId.delete(runId);
    }
  }
}

/**
 * Reconcile the denial ledger written by the preToolUse hook against the tool
 * calls accumulated from the stream, marking each denied call as
 * WAITING_APPROVAL.
 *
 * This is the cursor analog of the native harness synthesizing WAITING_APPROVAL
 * tool calls from LangGraph interrupts (execute-deep-agent/index.ts). The hook
 * ledger — not the SDK-reported tool status — is the authoritative record of
 * what was gated, because the hook is the only component that makes the per-call
 * allow/deny decision. The backend then projects pending_approvals from these
 * WAITING_APPROVAL tool calls (PendingApprovalComputer), so the approval surface
 * is driven entirely by tool-call status, exactly like the native harness.
 *
 * Correlation is by tool identity token (the same space as approvedGrantTokens),
 * not by call id: a denied tool's identity is stable, and a single resource
 * approved once should produce one approval regardless of how many times the
 * agent re-attempted it within the turn.
 *
 * If a ledger denial has no matching streamed tool call (rare — Cursor normally
 * emits a tool_call event for every attempt), a placeholder WAITING_APPROVAL
 * tool call is synthesized so the gate still surfaces and never renders as a
 * silent success.
 *
 * Returns the tool calls now marked WAITING_APPROVAL (overlaid + synthesized).
 */
export function reconcileDeniedToolCalls(
  messages: AgentMessage[],
  ledger: DeniedLedgerEntry[],
  mergedPolicies?: Map<string, MergedToolPolicy>,
): ToolCall[] {
  if (ledger.length === 0) return [];

  // One approval per denied identity; a resource re-attempted within the turn
  // is gated under the same token and collapses to a single approval.
  const deniedTokens = new Set(ledger.map((e) => e.token));
  const matched = new Set<string>();
  const result: ToolCall[] = [];

  // 1. Overlay WAITING_APPROVAL onto the streamed tool calls that were denied.
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const token = toolCallIdentityToken(tc);
      if (!deniedTokens.has(token) || matched.has(token)) continue;
      markWaitingApproval(tc, mergedPolicies);
      matched.add(token);
      result.push(tc);
    }
  }

  // 2. Synthesize a tool call for any denial that never produced a stream event.
  // Rare with correct correlation (Cursor emits a tool_call for every attempt),
  // so this is a defensive net that still surfaces the gate rather than letting
  // a denied tool render as a silent success.
  for (const entry of ledger) {
    if (matched.has(entry.token)) continue;
    const decoded = decodeIdentityToken(entry.token);
    // Display the hook's raw tool name; carry the decoded salient so the grant
    // rebuilt from this tool call on reinvocation keys on the same resource.
    const displayName = entry.toolName || decoded?.key || "tool";
    const salient = decoded?.salient ?? "";
    const tc = synthesizeWaitingApprovalToolCall(displayName, salient, entry.token, mergedPolicies);
    appendToolCallToLastAiMessage(messages, tc);
    matched.add(entry.token);
    result.push(tc);
  }

  return result;
}

/**
 * Compute a streamed tool call's identity token in the same canonical space the
 * preToolUse hook records denials in (see {@link toolIdentity} and grantToken).
 * The token keys on the cross-taxonomy category + salient resource, so a stream
 * `edit` (token `base64("write\n/path")`) correlates to the hook's `Write` deny
 * for the same path, even though the two layers name the tool differently.
 */
function toolCallIdentityToken(tc: ToolCall): string {
  const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
  return grantToken(id.key, id.salient);
}

/** Decode a grantToken back into its (key, salient) for the synthesis fallback. */
function decodeIdentityToken(token: string): { key: string; salient: string } | undefined {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const nl = decoded.indexOf("\n");
    if (nl < 0) return undefined;
    return { key: decoded.slice(0, nl), salient: decoded.slice(nl + 1) };
  } catch {
    return undefined;
  }
}

/** Best-effort args record for a tool call (proto struct, else parsed preview). */
function toolCallArgs(tc: ToolCall): Record<string, unknown> {
  if (tc.args && typeof tc.args === "object") {
    return tc.args as Record<string, unknown>;
  }
  if (tc.argsPreview) {
    try {
      const parsed = JSON.parse(tc.argsPreview);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return {};
}

/**
 * Mark a denied tool call as awaiting approval, clearing the result/terminal
 * fields the stream may have set (the tool never actually ran — it was gated).
 */
function markWaitingApproval(
  tc: ToolCall,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): void {
  tc.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
  tc.requiresApproval = true;
  if (!tc.approvalMessage) {
    tc.approvalMessage = resolveDeniedApprovalMessage(
      tc.name, tc.mcpServerSlug, toolCallArgs(tc), mergedPolicies,
    );
  }
  if (!tc.approvalRequestedAt) tc.approvalRequestedAt = utcTimestamp();
  tc.completedAt = "";
  tc.error = "";
  tc.result = "";
}

function synthesizeWaitingApprovalToolCall(
  displayName: string,
  salient: string,
  token: string,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): ToolCall {
  const tc = create(ToolCallSchema, {
    id: `approval:${token}`,
    name: displayName,
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: true,
    startedAt: utcTimestamp(),
    approvalRequestedAt: utcTimestamp(),
    toolKind: classifyTool(displayName),
  });
  // Carry the salient resource so reconstructAdjudicatedApprovals -> the grant
  // builder keys on the same resource the hook will see on the re-attempt.
  if (salient) {
    tc.argsPreview = JSON.stringify({ path: salient });
  }
  tc.approvalMessage = salient
    ? `Tool requires approval: ${displayName} (${salient})`
    : resolveDeniedApprovalMessage(displayName, "", {}, mergedPolicies);
  return tc;
}

/**
 * Resolve a human-readable approval message for a denied tool, preferring the
 * MCP policy template, then the built-in template, then a generic fallback.
 */
function resolveDeniedApprovalMessage(
  name: string,
  mcpServerSlug: string,
  args: Record<string, unknown>,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): string {
  if (mergedPolicies && mcpServerSlug) {
    const policy = lookupMcpToolPolicy(name, mcpServerSlug, mergedPolicies);
    if (policy) return resolveApprovalMessage(policy.approvalMessage, name, args);
  }
  if (!mcpServerSlug) {
    const template = getBuiltInApprovalMessage(name);
    if (template) return resolveApprovalMessage(template, name, args);
  }
  return `Tool requires approval: ${name}`;
}

/** Append a tool call to the last AI message, creating one if none exists. */
function appendToolCallToLastAiMessage(messages: AgentMessage[], tc: ToolCall): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === MessageType.MESSAGE_AI) {
      messages[i].toolCalls.push(tc);
      return;
    }
  }
  const msg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    timestamp: utcTimestamp(),
    toolCalls: [tc],
  });
  messages.push(msg);
}
