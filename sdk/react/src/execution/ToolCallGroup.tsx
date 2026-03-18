"use client";

import { useMemo, useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { ToolCallItem } from "./ToolCallItem";

export interface ToolCallGroupProps {
  readonly toolCalls: readonly ToolCall[];
  /**
   * Sub-agent executions from the parent `AgentExecutionStatus`.
   * When provided, tool calls whose `id` matches a
   * `SubAgentExecution.id` are rendered with a nested sub-agent
   * thread instead of a standard detail panel.
   */
  readonly subAgentExecutions?: readonly SubAgentExecution[];
  /**
   * Custom summary formatter. Receives the tool calls and returns a
   * display string. When omitted, the component uses a default that
   * shows the tool name for single calls and a count for multiple.
   */
  readonly formatSummary?: (toolCalls: readonly ToolCall[]) => string;
  /**
   * Initial expansion state. Defaults to `false`.
   */
  readonly defaultExpanded?: boolean;
  readonly className?: string;
}

type AggregateStatus = "running" | "waiting" | "failed" | "completed" | "pending";

function deriveAggregateStatus(toolCalls: readonly ToolCall[]): AggregateStatus {
  let hasRunning = false;
  let hasWaiting = false;
  let hasFailed = false;
  let allTerminal = true;

  for (const tc of toolCalls) {
    switch (tc.status) {
      case ToolCallStatus.TOOL_CALL_RUNNING:
        hasRunning = true;
        allTerminal = false;
        break;
      case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
        hasWaiting = true;
        allTerminal = false;
        break;
      case ToolCallStatus.TOOL_CALL_FAILED:
        hasFailed = true;
        break;
      case ToolCallStatus.TOOL_CALL_COMPLETED:
      case ToolCallStatus.TOOL_CALL_SKIPPED:
        break;
      default:
        allTerminal = false;
        break;
    }
  }

  if (hasRunning) return "running";
  if (hasWaiting) return "waiting";
  if (hasFailed) return "failed";
  if (allTerminal) return "completed";
  return "pending";
}

function defaultFormatSummary(toolCalls: readonly ToolCall[]): string {
  if (toolCalls.length === 1) {
    return toolCalls[0].name;
  }

  const uniqueNames = new Set(toolCalls.map((tc) => tc.name));
  if (uniqueNames.size === 1) {
    return `${toolCalls[0].name} \u00d7${toolCalls.length}`;
  }

  return `${toolCalls.length} tool calls`;
}

const STATUS_ICON: Record<AggregateStatus, () => React.JSX.Element> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: CheckCircleIcon,
  pending: DotIcon,
};

const STATUS_COLOR: Record<AggregateStatus, string> = {
  running: "text-foreground",
  waiting: "text-warning",
  failed: "text-destructive",
  completed: "text-success",
  pending: "text-muted-foreground",
};

/**
 * Renders a summary line for a group of tool calls from a single
 * AI turn. Click to expand and see individual tool calls.
 *
 * Two-level progressive disclosure:
 * 1. **Collapsed** — aggregate status icon + summary label.
 * 2. **Expanded** — list of {@link ToolCallItem} rows, each
 *    expandable to show detail (args, result, error, timing) or
 *    a nested sub-agent thread.
 *
 * Platform builders can provide a `formatSummary` prop for
 * domain-specific labels (e.g., "Ran 2 commands").
 *
 * @example
 * ```tsx
 * <ToolCallGroup toolCalls={message.toolCalls} />
 * ```
 */
export function ToolCallGroup({
  toolCalls,
  subAgentExecutions,
  formatSummary,
  defaultExpanded = false,
  className,
}: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const subAgentMap = useMemo(() => {
    if (!subAgentExecutions || subAgentExecutions.length === 0) return null;
    const map = new Map<string, SubAgentExecution>();
    for (const sub of subAgentExecutions) {
      map.set(sub.id, sub);
    }
    return map;
  }, [subAgentExecutions]);

  if (toolCalls.length === 0) return null;

  const status = deriveAggregateStatus(toolCalls);
  const summary = formatSummary
    ? formatSummary(toolCalls)
    : defaultFormatSummary(toolCalls);
  const Icon = STATUS_ICON[status];
  const ariaLabel = `${summary}, ${status}`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "rounded-md border border-border bg-muted/30",
        className,
      )}
    >
      {/* Summary trigger */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted/50",
          "cursor-pointer",
        )}
      >
        <span className={cn("shrink-0", STATUS_COLOR[status])} aria-hidden="true">
          <Icon />
        </span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Expanded tool call list — CSS grid-rows animation */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {expanded && (
            <div className="border-t border-border/50">
              {toolCalls.map((tc) => (
                <ToolCallItem
                  key={tc.id || tc.name}
                  toolCall={tc}
                  subAgentExecution={subAgentMap?.get(tc.id) ?? null}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — same as SP1, kept inline for SDK independence
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
    >
      <path
        d="M6 1.5A4.5 4.5 0 1 1 1.5 6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
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
      width="12"
      height="12"
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
      width="12"
      height="12"
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
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="currentColor"
    >
      <circle cx="4" cy="4" r="3" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
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
      <path d="M4.5 2.5L7.5 6L4.5 9.5" />
    </svg>
  );
}
