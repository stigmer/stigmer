"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev";
import { ToolCallItem } from "./ToolCallItem";
import { resolveToolCategory, extractPrimaryArg } from "./tool-categories";

/** Props for {@link ToolCallGroup}. */
export interface ToolCallGroupProps {
  /** Tool calls in this group, ordered by invocation time. */
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
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

type AggregateStatus = "running" | "waiting" | "failed" | "completed" | "pending";

function isResolvedApproval(tc: ToolCall): boolean {
  return (
    tc.approvalAction === ApprovalAction.APPROVE ||
    tc.approvalAction === ApprovalAction.SKIP ||
    tc.approvalAction === ApprovalAction.REJECT
  );
}

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
        if (isResolvedApproval(tc)) {
          break;
        }
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

function defaultFormatSummary(
  toolCalls: readonly ToolCall[],
  status: AggregateStatus,
): string {
  if (toolCalls.length === 1) {
    const tc = toolCalls[0];
    const cat = resolveToolCategory(tc.name, tc.mcpServerSlug);
    const primary = extractPrimaryArg(tc);
    if (primary) {
      const truncated =
        primary.length > 60 ? primary.slice(0, 57) + "\u2026" : primary;
      return `${cat.label}: ${truncated}`;
    }
    return cat.label;
  }

  const noun = toolCalls.length === 1 ? "tool" : "tools";
  switch (status) {
    case "running":
      return `Running ${toolCalls.length} ${noun}`;
    case "waiting":
      return "Waiting for approval";
    case "failed":
      return `Ran ${toolCalls.length} ${noun} (with errors)`;
    case "completed":
      return `Ran ${toolCalls.length} ${noun}`;
    case "pending":
      return `${toolCalls.length} ${noun} pending`;
  }
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
 * Shallow comparison for `ToolCallGroupProps`.
 *
 * The `toolCalls` array may be a newly allocated subset (e.g.
 * `buildThreadItems` filters out `task` calls). Structural sharing
 * (T04) keeps individual `ToolCall` objects stable, so we compare
 * array elements by reference rather than the array itself.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function toolCallGroupPropsEqual(
  prev: Readonly<ToolCallGroupProps>,
  next: Readonly<ToolCallGroupProps>,
): boolean {
  if (prev.toolCalls.length !== next.toolCalls.length) return false;
  for (let i = 0; i < prev.toolCalls.length; i++) {
    if (prev.toolCalls[i] !== next.toolCalls[i]) return false;
  }
  return (
    prev.subAgentExecutions === next.subAgentExecutions &&
    prev.formatSummary === next.formatSummary &&
    prev.defaultExpanded === next.defaultExpanded &&
    prev.className === next.className
  );
}

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
 * Default summaries use active-voice phrasing ("Ran 3 tools",
 * "Running 2 tools") with category-aware labels for single tools
 * (e.g., "Shell: ls -la /tmp"). Platform builders can override
 * via the `formatSummary` prop.
 *
 * Wrapped in `React.memo` with a custom comparator that checks
 * `toolCalls` elements by reference (structural sharing keeps
 * individual `ToolCall` objects stable for unchanged calls).
 *
 * @example
 * ```tsx
 * <ToolCallGroup toolCalls={message.toolCalls} />
 * ```
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  toolCalls,
  subAgentExecutions,
  formatSummary,
  defaultExpanded = false,
  className,
}: ToolCallGroupProps) {
  useRenderTracer("ToolCallGroup", { toolCallCount: toolCalls.length });

  const status = deriveAggregateStatus(toolCalls);
  const isActive = status === "running" || status === "pending" || status === "waiting";

  const [expanded, setExpanded] = useState(defaultExpanded || isActive);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (userToggledRef.current) return;
    if (isActive) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [isActive]);

  const handleToggle = () => {
    userToggledRef.current = true;
    setExpanded((v) => !v);
  };

  const subAgentMap = useMemo(() => {
    if (!subAgentExecutions || subAgentExecutions.length === 0) return null;
    const map = new Map<string, SubAgentExecution>();
    for (const sub of subAgentExecutions) {
      map.set(sub.id, sub);
    }
    return map;
  }, [subAgentExecutions]);

  if (toolCalls.length === 0) return null;

  const summary = formatSummary
    ? formatSummary(toolCalls)
    : defaultFormatSummary(toolCalls, status);
  const Icon = STATUS_ICON[status];
  const ariaLabel = `${summary}, ${status}`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "rounded-md border border-border bg-muted-faint",
        className,
      )}
    >
      {/* Summary trigger */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted-subtle",
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
            <div className="border-t border-border-muted">
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
}, toolCallGroupPropsEqual);

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
