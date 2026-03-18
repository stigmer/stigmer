"use client";

import { useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { ToolCallDetail, formatDuration } from "./ToolCallDetail";
import { SubAgentSection } from "./SubAgentSection";

export interface ToolCallItemProps {
  readonly toolCall: ToolCall;
  /**
   * When present, this tool call is a sub-agent delegation. The
   * detail panel renders a {@link SubAgentSection} instead of
   * a {@link ToolCallDetail}.
   */
  readonly subAgentExecution?: SubAgentExecution | null;
  /**
   * Initial expansion state. Defaults to `false`.
   */
  readonly defaultExpanded?: boolean;
  readonly className?: string;
}

/**
 * Renders a single tool call as a clickable row that expands to show
 * either a {@link ToolCallDetail} (regular tool) or a
 * {@link SubAgentSection} (sub-agent delegation).
 *
 * This is Level 2 of the two-level progressive disclosure in the
 * conversation thread.
 *
 * @example
 * ```tsx
 * <ToolCallItem toolCall={tc} />
 * <ToolCallItem toolCall={tc} subAgentExecution={sub} />
 * ```
 */
export function ToolCallItem({
  toolCall,
  subAgentExecution,
  defaultExpanded = false,
  className,
}: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const status = mapToolCallStatus(toolCall.status);
  const Icon = STATUS_ICON[status];
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const isSubAgent = subAgentExecution != null;
  const displayName = isSubAgent
    ? subAgentExecution.subject || subAgentExecution.name || toolCall.name
    : toolCall.name;

  return (
    <div className={cn("border-b border-border/50 last:border-b-0", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
          "hover:bg-muted/50",
          expanded && "bg-muted/30",
        )}
      >
        {/* Status icon */}
        <span
          className={cn("shrink-0", STATUS_COLOR[status])}
          aria-hidden="true"
        >
          <Icon />
        </span>

        {/* Tool name */}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {displayName}
        </span>

        {/* MCP server badge */}
        {toolCall.mcpServerSlug && (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-muted-foreground">
            {toolCall.mcpServerSlug}
          </span>
        )}

        {/* Duration */}
        {duration && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {duration}
          </span>
        )}

        {/* Chevron */}
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Expanded detail panel — only mounted when expanded */}
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1">
          {isSubAgent ? (
            <SubAgentSection subAgentExecution={subAgentExecution} />
          ) : (
            <ToolCallDetail toolCall={toolCall} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status mapping — reuses the same vocabulary as ToolCallGroup
// ---------------------------------------------------------------------------

type ItemStatus = "running" | "waiting" | "failed" | "completed" | "pending";

function mapToolCallStatus(status: ToolCallStatus): ItemStatus {
  switch (status) {
    case ToolCallStatus.TOOL_CALL_RUNNING:
      return "running";
    case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
      return "waiting";
    case ToolCallStatus.TOOL_CALL_FAILED:
      return "failed";
    case ToolCallStatus.TOOL_CALL_COMPLETED:
    case ToolCallStatus.TOOL_CALL_SKIPPED:
      return "completed";
    default:
      return "pending";
  }
}

const STATUS_COLOR: Record<ItemStatus, string> = {
  running: "text-foreground",
  waiting: "text-warning",
  failed: "text-destructive",
  completed: "text-success",
  pending: "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Inline SVG icons — SDK pattern (no lucide-react dependency)
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<ItemStatus, () => React.JSX.Element> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: CheckCircleIcon,
  pending: DotIcon,
};

function SpinnerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4 6L5.5 7.5L8 4.5" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4.5 4.5L7.5 7.5M7.5 4.5L4.5 7.5" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <circle cx="4" cy="4" r="2.5" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 text-muted-foreground transition-transform duration-150",
        expanded && "rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
