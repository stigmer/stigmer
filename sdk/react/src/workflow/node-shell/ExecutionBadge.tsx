"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { NodeExecutionStatus } from "../workflow-graph-conversions";

/** Fork branch completion progress (T06). */
export interface ForkProgressInfo {
  readonly completed: number;
  readonly total: number;
  readonly compete: boolean;
}

export interface ExecutionBadgeProps {
  readonly status: NodeExecutionStatus;
  readonly attemptNumber?: number;
  /** Fork branch progress. When present on a running fork node, replaces the generic spinner. */
  readonly forkProgress?: ForkProgressInfo;
  /** Tool name awaiting approval. Displayed in the badge when status is waiting_approval. */
  readonly approvalToolName?: string;
}

/**
 * Compact status badge rendered at the top-right corner of a workflow node
 * in execution mode. Provides text/icon differentiation beyond color alone
 * (WCAG 1.4.1 compliance).
 *
 * For fork nodes, displays branch completion progress (e.g. "1/3") when
 * the fork is running and `forkProgress` is provided (T06).
 *
 * Uses the same positioning pattern as the validation error badge in
 * `WorkflowNode.tsx`.
 */
export const ExecutionBadge = memo(function ExecutionBadge({
  status,
  attemptNumber,
  forkProgress,
  approvalToolName,
}: ExecutionBadgeProps) {
  if (status === "not_reached" || status === "pending") return null;

  // Approval-specific badge: show tool name when available.
  if (status === "waiting_approval" && approvalToolName) {
    const approvalLabel = `Awaiting approval: ${approvalToolName}`;
    return (
      <span
        className={cn(
          "absolute -right-1.5 -top-1.5 z-20 flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold leading-none shadow-sm",
          "bg-[var(--stgm-warning,#f59e0b)] text-white",
        )}
        title={approvalLabel}
        aria-label={approvalLabel}
      >
        ✋
        <span className="max-w-[60px] truncate">{approvalToolName}</span>
      </span>
    );
  }

  // Fork-specific running badge: show branch progress instead of generic spinner.
  if (status === "running" && forkProgress) {
    const progressLabel = forkProgress.compete
      ? `Fork race, ${forkProgress.completed} of ${forkProgress.total} branches completed`
      : `Fork running, ${forkProgress.completed} of ${forkProgress.total} branches completed`;

    return (
      <span
        className={cn(
          "absolute -right-1.5 -top-1.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none shadow-sm",
          "bg-[var(--stgm-primary,#6366f1)] text-white stgm-exec-badge-running",
        )}
        title={progressLabel}
        aria-label={progressLabel}
      >
        {forkProgress.completed}/{forkProgress.total}
        {forkProgress.compete && <span className="ml-0.5">⚡</span>}
      </span>
    );
  }

  const { icon, label, className } = BADGE_CONFIG[status];

  return (
    <span
      className={cn(
        "absolute -right-1.5 -top-1.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none shadow-sm",
        className,
      )}
      title={label + (attemptNumber && attemptNumber > 1 ? ` (attempt ${attemptNumber})` : "")}
      aria-label={label}
    >
      {icon}
      {status === "retrying" && attemptNumber != null && attemptNumber > 1 && (
        <span className="ml-0.5">{attemptNumber}</span>
      )}
    </span>
  );
});

interface BadgeConfig {
  icon: string;
  label: string;
  className: string;
}

const BADGE_CONFIG: Record<Exclude<NodeExecutionStatus, "not_reached" | "pending">, BadgeConfig> = {
  running: {
    icon: "⟳",
    label: "Running",
    className: "bg-[var(--stgm-primary,#6366f1)] text-white stgm-exec-badge-running",
  },
  completed: {
    icon: "✓",
    label: "Completed",
    className: "bg-[var(--stgm-success,#22c55e)] text-white",
  },
  failed: {
    icon: "✕",
    label: "Failed",
    className: "bg-[var(--stgm-destructive,#ef4444)] text-white",
  },
  skipped: {
    icon: "—",
    label: "Skipped",
    className: "bg-[var(--stgm-muted,#e5e5e5)] text-[var(--stgm-muted-foreground,#737373)]",
  },
  retrying: {
    icon: "↻",
    label: "Retrying",
    className: "bg-[var(--stgm-warning,#f59e0b)] text-white",
  },
  waiting_approval: {
    icon: "✋",
    label: "Waiting for approval",
    className: "bg-[var(--stgm-warning,#f59e0b)] text-white",
  },
};
