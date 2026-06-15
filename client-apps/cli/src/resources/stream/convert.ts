// Proto → domain converters for the snapshot differ.
//
// Ports the Go CLI's run_stream_convert.go + run_display_tools.go + the error
// sanitizer in run_display.go. These are pure mappings from generated proto
// types to the differ's render-agnostic event payloads (events.ts), keeping the
// enum/string translation in exactly one place.

import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import {
  ExecutionPhase,
  SubAgentStatus,
  SummarizationSource,
  ToolCallStatus,
  TodoStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCallInfo, TodoItemView } from "./events.js";

/** Mapped tool-call status strings. */
export type ToolStatus = "pending" | "running" | "completed" | "failed" | "waiting_approval" | "skipped" | "unknown";

/** Convert a proto ToolCall to render info. Mirrors Go's convertToolCall. */
export function convertToolCall(tc: ToolCall): ToolCallInfo {
  return {
    id: tc.id,
    name: tc.name,
    status: mapToolCallStatus(tc.status),
    args: tc.args,
    result: tc.result,
    error: tc.error,
    durationMs: computeDurationMs(tc.startedAt, tc.completedAt),
  };
}

/** Convert a slice of proto ToolCalls. Mirrors Go's convertToolCalls. */
export function convertToolCalls(toolCalls: readonly ToolCall[]): ToolCallInfo[] {
  return toolCalls.map(convertToolCall);
}

/** Flatten every tool call embedded in a message list. Mirrors Go's collectToolCallsFromMessages. */
export function collectToolCallsFromMessages(messages: readonly AgentMessage[]): ToolCall[] {
  const result: ToolCall[] = [];
  for (const msg of messages) result.push(...msg.toolCalls);
  return result;
}

/** Find a tool call by ID, searching root then sub-agent messages. Mirrors Go's findToolCallByID. */
export function findToolCallById(
  toolCalls: readonly ToolCall[],
  subAgents: readonly SubAgentExecution[],
  id: string,
): ToolCall | undefined {
  for (const tc of toolCalls) {
    if (tc.id === id) return tc;
  }
  for (const sa of subAgents) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        if (tc.id === id) return tc;
      }
    }
  }
  return undefined;
}

/** Convert the proto todo map to render items. Mirrors Go's convertProtoTodos. */
export function convertProtoTodos(todos: Record<string, TodoItem>): TodoItemView[] {
  return Object.values(todos).map((item) => ({
    id: item.id,
    content: item.content,
    status: mapTodoStatus(item.status),
  }));
}

/** Map an ExecutionPhase to its differ string. Mirrors Go's mapPhaseToString. */
export function mapPhaseToString(phase: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PENDING:
      return "pending";
    case ExecutionPhase.EXECUTION_IN_PROGRESS:
      return "in_progress";
    case ExecutionPhase.EXECUTION_COMPLETED:
      return "completed";
    case ExecutionPhase.EXECUTION_FAILED:
      return "failed";
    case ExecutionPhase.EXECUTION_CANCELLED:
      return "cancelled";
    case ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
      return "waiting_for_approval";
    case ExecutionPhase.EXECUTION_TERMINATED:
      return "terminated";
    default:
      return "unknown";
  }
}

/** Map a ToolCallStatus to its differ string. Mirrors Go's mapToolCallStatus. */
export function mapToolCallStatus(status: ToolCallStatus): ToolStatus {
  switch (status) {
    case ToolCallStatus.TOOL_CALL_PENDING:
      return "pending";
    case ToolCallStatus.TOOL_CALL_RUNNING:
      return "running";
    case ToolCallStatus.TOOL_CALL_COMPLETED:
      return "completed";
    case ToolCallStatus.TOOL_CALL_FAILED:
      return "failed";
    case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
      return "waiting_approval";
    case ToolCallStatus.TOOL_CALL_SKIPPED:
      return "skipped";
    default:
      return "unknown";
  }
}

/** Map a TodoStatus to its differ string (UNSPECIFIED→pending). Mirrors Go's mapTodoStatus. */
export function mapTodoStatus(status: TodoStatus): string {
  switch (status) {
    case TodoStatus.TODO_PENDING:
      return "pending";
    case TodoStatus.TODO_IN_PROGRESS:
      return "in_progress";
    case TodoStatus.TODO_COMPLETED:
      return "completed";
    case TodoStatus.TODO_CANCELLED:
      return "cancelled";
    default:
      return "pending";
  }
}

/** Map a SummarizationSource to its differ string. Mirrors Go's mapSummarizationSource. */
export function mapSummarizationSource(source: SummarizationSource): string {
  switch (source) {
    case SummarizationSource.graph_start:
      return "graph_start";
    case SummarizationSource.mid_execution:
      return "mid_execution";
    default:
      return "unknown";
  }
}

/** The protojson enum name for a sub-agent status (matches Go's status.String()). */
export function subAgentStatusName(status: SubAgentStatus): string {
  return SubAgentStatus[status] ?? "SUB_AGENT_STATUS_UNSPECIFIED";
}

/** True for tool statuses that mean the tool is no longer executing. Mirrors Go's isTerminalToolStatus. */
export function isTerminalToolStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "skipped";
}

/** True for terminal agent phases. Mirrors Go's isTerminalAgentPhase. */
export function isTerminalAgentPhase(phase: ExecutionPhase): boolean {
  return (
    phase === ExecutionPhase.EXECUTION_COMPLETED ||
    phase === ExecutionPhase.EXECUTION_FAILED ||
    phase === ExecutionPhase.EXECUTION_CANCELLED ||
    phase === ExecutionPhase.EXECUTION_TERMINATED
  );
}

/** True for terminal sub-agent statuses. Mirrors Go's isTerminalSubAgentStatus. */
export function isTerminalSubAgentStatus(status: SubAgentStatus): boolean {
  return (
    status === SubAgentStatus.SUB_AGENT_COMPLETED ||
    status === SubAgentStatus.SUB_AGENT_FAILED ||
    status === SubAgentStatus.SUB_AGENT_CANCELLED
  );
}

// Raw HTTP/API error response pattern that leaks internals. Mirrors Go's rawAPIErrorPattern.
const RAW_API_ERROR = /Error code: \d+ - [{'"]/;
const RAW_EXCEPTION_PATTERNS = ["invalid_request_error", "request_id", "'type': 'error'", '"type": "error"'];

/** Rewrite raw API/exception errors into clean text. Mirrors Go's sanitizeSystemContent. */
export function sanitizeSystemContent(content: string): string {
  if (!isRawErrorContent(content)) return content;

  const idx = content.indexOf("Error code:");
  if (idx > 0) {
    const prefix = content.slice(0, idx).trim().replace(/[:\-\s]+$/, "");
    if (prefix !== "") return `${prefix} (internal error — check execution logs for details)`;
  }
  return "Agent execution encountered an internal error. Check execution logs for details.";
}

/** True when the system message looks like an approval-received acknowledgement. Mirrors Go's isApprovalNoiseMessage. */
export function isApprovalNoiseMessage(content: string): boolean {
  return content.includes("Approval received");
}

function isRawErrorContent(content: string): boolean {
  if (RAW_API_ERROR.test(content)) return true;
  return RAW_EXCEPTION_PATTERNS.some((p) => content.includes(p));
}

// Elapsed ms between two RFC3339 timestamps, or 0 when either is missing,
// unparseable, or negative. Mirrors Go's computeToolCallDuration.
function computeDurationMs(startedAt: string, completedAt: string): number {
  if (startedAt === "" || completedAt === "") return 0;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const d = end - start;
  return d < 0 ? 0 : d;
}
