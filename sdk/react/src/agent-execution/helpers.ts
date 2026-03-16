import {
  ExecutionPhase,
  ToolCallStatus,
  SubAgentStatus,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

// ---------------------------------------------------------------------------
// Execution phase utilities
// ---------------------------------------------------------------------------

const TERMINAL_PHASES = new Set<ExecutionPhase>([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

export function isTerminalPhase(phase: ExecutionPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

const PHASE_LABELS: Record<ExecutionPhase, string> = {
  [ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED]: "Unknown",
  [ExecutionPhase.EXECUTION_PENDING]: "Pending",
  [ExecutionPhase.EXECUTION_IN_PROGRESS]: "Running",
  [ExecutionPhase.EXECUTION_COMPLETED]: "Completed",
  [ExecutionPhase.EXECUTION_FAILED]: "Failed",
  [ExecutionPhase.EXECUTION_CANCELLED]: "Cancelled",
  [ExecutionPhase.EXECUTION_TERMINATED]: "Terminated",
  [ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL]: "Waiting for Approval",
  [ExecutionPhase.EXECUTION_PAUSED]: "Paused",
};

export function phaseLabel(phase: ExecutionPhase): string {
  return PHASE_LABELS[phase] ?? "Unknown";
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const PHASE_VARIANTS: Record<ExecutionPhase, BadgeVariant> = {
  [ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED]: "outline",
  [ExecutionPhase.EXECUTION_PENDING]: "outline",
  [ExecutionPhase.EXECUTION_IN_PROGRESS]: "default",
  [ExecutionPhase.EXECUTION_COMPLETED]: "secondary",
  [ExecutionPhase.EXECUTION_FAILED]: "destructive",
  [ExecutionPhase.EXECUTION_CANCELLED]: "outline",
  [ExecutionPhase.EXECUTION_TERMINATED]: "destructive",
  [ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL]: "default",
  [ExecutionPhase.EXECUTION_PAUSED]: "outline",
};

export function phaseVariant(phase: ExecutionPhase): BadgeVariant {
  return PHASE_VARIANTS[phase] ?? "outline";
}

// ---------------------------------------------------------------------------
// Tool call status utilities
// ---------------------------------------------------------------------------

const TOOL_CALL_STATUS_LABELS: Record<ToolCallStatus, string> = {
  [ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED]: "Unknown",
  [ToolCallStatus.TOOL_CALL_PENDING]: "Pending",
  [ToolCallStatus.TOOL_CALL_RUNNING]: "Running",
  [ToolCallStatus.TOOL_CALL_COMPLETED]: "Completed",
  [ToolCallStatus.TOOL_CALL_FAILED]: "Failed",
  [ToolCallStatus.TOOL_CALL_WAITING_APPROVAL]: "Awaiting Approval",
  [ToolCallStatus.TOOL_CALL_SKIPPED]: "Skipped",
};

export function toolCallStatusLabel(status: ToolCallStatus): string {
  return TOOL_CALL_STATUS_LABELS[status] ?? "Unknown";
}

const TOOL_CALL_STATUS_VARIANTS: Record<ToolCallStatus, BadgeVariant> = {
  [ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED]: "outline",
  [ToolCallStatus.TOOL_CALL_PENDING]: "outline",
  [ToolCallStatus.TOOL_CALL_RUNNING]: "default",
  [ToolCallStatus.TOOL_CALL_COMPLETED]: "secondary",
  [ToolCallStatus.TOOL_CALL_FAILED]: "destructive",
  [ToolCallStatus.TOOL_CALL_WAITING_APPROVAL]: "default",
  [ToolCallStatus.TOOL_CALL_SKIPPED]: "outline",
};

export function toolCallStatusVariant(status: ToolCallStatus): BadgeVariant {
  return TOOL_CALL_STATUS_VARIANTS[status] ?? "outline";
}

export function isToolCallTerminal(status: ToolCallStatus): boolean {
  return (
    status === ToolCallStatus.TOOL_CALL_COMPLETED ||
    status === ToolCallStatus.TOOL_CALL_FAILED ||
    status === ToolCallStatus.TOOL_CALL_SKIPPED
  );
}

// ---------------------------------------------------------------------------
// Sub-agent status utilities
// ---------------------------------------------------------------------------

const SUB_AGENT_STATUS_LABELS: Record<SubAgentStatus, string> = {
  [SubAgentStatus.SUB_AGENT_STATUS_UNSPECIFIED]: "Unknown",
  [SubAgentStatus.SUB_AGENT_PENDING]: "Pending",
  [SubAgentStatus.SUB_AGENT_IN_PROGRESS]: "Running",
  [SubAgentStatus.SUB_AGENT_COMPLETED]: "Completed",
  [SubAgentStatus.SUB_AGENT_FAILED]: "Failed",
  [SubAgentStatus.SUB_AGENT_CANCELLED]: "Cancelled",
};

export function subAgentStatusLabel(status: SubAgentStatus): string {
  return SUB_AGENT_STATUS_LABELS[status] ?? "Unknown";
}

const SUB_AGENT_STATUS_VARIANTS: Record<SubAgentStatus, BadgeVariant> = {
  [SubAgentStatus.SUB_AGENT_STATUS_UNSPECIFIED]: "outline",
  [SubAgentStatus.SUB_AGENT_PENDING]: "outline",
  [SubAgentStatus.SUB_AGENT_IN_PROGRESS]: "default",
  [SubAgentStatus.SUB_AGENT_COMPLETED]: "secondary",
  [SubAgentStatus.SUB_AGENT_FAILED]: "destructive",
  [SubAgentStatus.SUB_AGENT_CANCELLED]: "outline",
};

export function subAgentStatusVariant(status: SubAgentStatus): BadgeVariant {
  return SUB_AGENT_STATUS_VARIANTS[status] ?? "outline";
}

// ---------------------------------------------------------------------------
// Message type utilities
// ---------------------------------------------------------------------------

export function isHumanMessage(type: MessageType): boolean {
  return type === MessageType.MESSAGE_HUMAN;
}

export function isAiMessage(type: MessageType): boolean {
  return type === MessageType.MESSAGE_AI;
}

export function isToolMessage(type: MessageType): boolean {
  return type === MessageType.MESSAGE_TOOL;
}

export function isSystemMessage(type: MessageType): boolean {
  return type === MessageType.MESSAGE_SYSTEM;
}

// ---------------------------------------------------------------------------
// Execution-level helpers
// ---------------------------------------------------------------------------

/**
 * Build an index of sub-agent executions keyed by their ID.
 * The sub-agent ID matches the tool call ID from the parent's "task" tool
 * invocation, enabling O(1) lookup when rendering tool calls that represent
 * sub-agent delegations.
 */
export function buildSubAgentIndex(
  execution: AgentExecution,
): Map<string, SubAgentExecution> {
  const subAgents = execution.status?.subAgentExecutions;
  if (!subAgents || subAgents.length === 0) return new Map();
  return new Map(subAgents.map((sa) => [sa.id, sa]));
}

/**
 * Format a qualified tool name: "mcp-server/tool-name" when an MCP server
 * slug is present, or just "tool-name" for built-in sandbox tools.
 */
export function qualifiedToolName(name: string, mcpServerSlug: string): string {
  if (mcpServerSlug) return `${mcpServerSlug}/${name}`;
  return name;
}

/**
 * Format elapsed time between two ISO timestamps as a human-readable duration.
 * Returns null if either timestamp is missing.
 */
export function formatDuration(
  startedAt: string,
  completedAt: string,
): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
