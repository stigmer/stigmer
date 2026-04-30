/**
 * Translates Cursor SDK streaming events into Stigmer AgentMessage protos.
 *
 * The Cursor SDK emits SDKMessage events during a Run. This module maps
 * each event type to the corresponding Stigmer proto type (AgentMessage,
 * ToolCall, etc.) so status updates sent to the Stigmer server look
 * identical regardless of which harness produced them.
 */

import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";

export function utcTimestamp(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

/**
 * Translate a single Cursor SDKMessage into zero or more Stigmer AgentMessages.
 *
 * Most events produce exactly one message. Some (like system init) are
 * informational and produce none.
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

function translateToolCall(event: Extract<SDKMessage, { type: "tool_call" }>): AgentMessage {
  const status = mapToolCallStatus(event.status);
  const toolCall = create(ToolCallSchema, {
    id: event.call_id,
    name: event.name,
    status,
    startedAt: status === ToolCallStatus.TOOL_CALL_RUNNING ? utcTimestamp() : "",
    completedAt: isTerminalToolStatus(status) ? utcTimestamp() : "",
    result: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? ""),
    error: status === ToolCallStatus.TOOL_CALL_FAILED
      ? (typeof event.result === "string" ? event.result : "Tool call failed")
      : "",
  });

  if (event.args != null) {
    toolCall.argsPreview = typeof event.args === "string"
      ? event.args
      : JSON.stringify(event.args);
  }

  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_TOOL,
    content: `Tool: ${event.name} [${event.status}]`,
    timestamp: utcTimestamp(),
    toolCalls: [toolCall],
  });
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

function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return (
    status === ToolCallStatus.TOOL_CALL_COMPLETED ||
    status === ToolCallStatus.TOOL_CALL_FAILED ||
    status === ToolCallStatus.TOOL_CALL_SKIPPED
  );
}

/**
 * Extract denied tool call details from stream events for HITL reporting.
 *
 * When a preToolUse hook denies a tool, Cursor emits a tool_call event
 * with status "error". This function identifies those denied calls so the
 * activity can populate pending_approvals.
 */
export interface DeniedToolCall {
  callId: string;
  name: string;
  argsPreview: string;
}

export function extractDeniedToolCalls(events: SDKMessage[]): DeniedToolCall[] {
  return events
    .filter((e): e is Extract<SDKMessage, { type: "tool_call" }> =>
      e.type === "tool_call" && e.status === "error")
    .map((e) => ({
      callId: e.call_id,
      name: e.name,
      argsPreview: e.args != null
        ? (typeof e.args === "string" ? e.args : JSON.stringify(e.args))
        : "",
    }));
}
