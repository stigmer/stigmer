"use client";

import { memo, useContext, useMemo } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { ApprovalContext } from "./ApprovalContext.js";
import { ToolCallItem, CATEGORY_ICON } from "./ToolCallItem.js";
import type { ToolCategory } from "./tool-categories.js";

/** Props for {@link ToolRunGroup}. */
export interface ToolRunGroupProps {
  /** Shared category of every call in the run (e.g. `"read"`). */
  readonly category: ToolCategory;
  /** The consecutive same-category calls folded into this chip (length >= 2). */
  readonly toolCalls: readonly ToolCall[];
  /**
   * Custom label formatter for the collapsed chip. When omitted, a
   * category-aware default is used ("Read 5 files"). Receives the run's calls so
   * a platform builder can phrase the summary however they like.
   */
  readonly formatLabel?: (toolCalls: readonly ToolCall[]) => string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The thread's *only* collapse: a run of consecutive low-signal same-category
 * calls (read / list / search) folded into one chip — the noise-reduction half
 * of the persistent-row timeline. Collapsed, it reads as one line ("Read 5
 * files"); expanded, it reveals the individual {@link ToolCallItem} rows.
 *
 * Unlike the old per-turn group, this folds *only* genuine repetition, and it
 * auto-opens (and stays open) if any folded call is awaiting approval — a gate
 * raised inside a run must never be buried. It otherwise settles closed when
 * the run finishes, unless the user has taken manual control (see
 * {@link useAutoDisclosure}).
 *
 * `React.memo` with a by-reference comparator: structural sharing keeps each
 * folded `ToolCall` stable, so a settled chip skips re-renders while siblings
 * stream (DD-009/010).
 *
 * @example
 * ```tsx
 * <ToolRunGroup category="read" toolCalls={reads} />
 * ```
 */
export const ToolRunGroup = memo(function ToolRunGroup({
  category,
  toolCalls,
  formatLabel,
  className,
}: ToolRunGroupProps) {
  useRenderTracer("ToolRunGroup", { category, count: toolCalls.length });

  const status = deriveAggregateStatus(toolCalls);
  const isActive =
    status === "running" || status === "waiting" || status === "pending";

  // A gate raised inside a folded run must be reachable without a click. Reads
  // are ungated by default, but a presenter override (or future policy) could
  // gate one — so we honour the same inline-approval reachability the rest of
  // the thread guarantees, mirroring SubAgentSection.
  const { approvalsByToolCallId } = useContext(ApprovalContext);
  const hasPendingApprovalInside = useMemo(() => {
    if (approvalsByToolCallId.size === 0) return false;
    return toolCalls.some((tc) => tc.id && approvalsByToolCallId.has(tc.id));
  }, [toolCalls, approvalsByToolCallId]);

  const [expanded, handleToggle] = useAutoDisclosure(
    isActive || hasPendingApprovalInside,
  );

  const label = formatLabel
    ? formatLabel(toolCalls)
    : defaultRunLabel(category, toolCalls.length);
  const Icon = CATEGORY_ICON[category];
  const StatusIcon = STATUS_ICON[status];

  return (
    <div
      role="group"
      aria-label={label}
      data-cursor-target="tool-run-group"
      className={cn(
        "rounded-lg border border-border-prominent overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted-subtle",
          // ring-inset so the card's overflow-hidden does not clip the focus ring.
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          <Icon />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {label}
        </span>
        <span className={cn("shrink-0", STATUS_COLOR[status])} aria-hidden="true">
          <StatusIcon />
        </span>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t border-border-muted">
          {/* The chip is already the card; its children render as
              divider-separated rows (bordered={false}) to avoid a card-in-a-card. */}
          {toolCalls.map((tc) => (
            <ToolCallItem key={tc.id || tc.name} toolCall={tc} bordered={false} />
          ))}
        </div>
      )}
    </div>
  );
}, toolRunGroupPropsEqual);

/**
 * Shallow comparison for {@link ToolRunGroupProps}. Structural sharing keeps the
 * folded `ToolCall` objects stable, so we compare the array element-wise by
 * reference rather than by identity of the (freshly sliced) array.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function toolRunGroupPropsEqual(
  prev: Readonly<ToolRunGroupProps>,
  next: Readonly<ToolRunGroupProps>,
): boolean {
  if (prev.category !== next.category) return false;
  if (prev.toolCalls.length !== next.toolCalls.length) return false;
  for (let i = 0; i < prev.toolCalls.length; i++) {
    if (prev.toolCalls[i] !== next.toolCalls[i]) return false;
  }
  return prev.formatLabel === next.formatLabel && prev.className === next.className;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Category-aware default label for a folded run (count is always >= 2). */
function defaultRunLabel(category: ToolCategory, count: number): string {
  switch (category) {
    case "read":
      return `Read ${count} files`;
    case "list":
      return `Listed ${count} directories`;
    case "search":
      return `Searched ${count} times`;
    default:
      return `${count} calls`;
  }
}

// ---------------------------------------------------------------------------
// Aggregate status
// ---------------------------------------------------------------------------

type AggregateStatus = "running" | "waiting" | "failed" | "completed" | "pending";

function isResolvedApproval(tc: ToolCall): boolean {
  return (
    tc.approvalAction === ApprovalAction.APPROVE ||
    tc.approvalAction === ApprovalAction.SKIP ||
    tc.approvalAction === ApprovalAction.REJECT
  );
}

/** Collapses a run's per-call statuses into a single chip status. */
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
        if (isResolvedApproval(tc)) break;
        hasWaiting = true;
        allTerminal = false;
        break;
      case ToolCallStatus.TOOL_CALL_FAILED:
        hasFailed = true;
        break;
      case ToolCallStatus.TOOL_CALL_COMPLETED:
      case ToolCallStatus.TOOL_CALL_SKIPPED:
      // INTERRUPTED is terminal (platform-settled when the execution
      // terminalized mid-call, issue #207): the chip must settle, not pin to
      // "pending" forever.
      case ToolCallStatus.TOOL_CALL_INTERRUPTED:
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

const STATUS_COLOR: Record<AggregateStatus, string> = {
  running: "text-foreground",
  waiting: "text-warning",
  failed: "text-destructive",
  completed: "text-success",
  pending: "text-muted-foreground",
};

const STATUS_ICON: Record<AggregateStatus, () => React.JSX.Element> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: CheckCircleIcon,
  pending: DotIcon,
};

// ---------------------------------------------------------------------------
// Inline SVG icons — kept inline for SDK independence (codebase pattern)
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4 6L5.5 7.5L8 4.5" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
