"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { NodeExecutionStatus } from "../workflow-graph-conversions.js";

/** Fork branch completion progress (T06). */
export interface ForkProgressInfo {
  readonly completed: number;
  readonly total: number;
  readonly compete: boolean;
}

/** Live agent activity summary for running agent_call nodes. */
export interface AgentActivityInfo {
  readonly agentSlug: string;
  readonly currentToolName: string;
  readonly messagesCount: number;
  readonly toolCallsCount: number;
}

export interface ExecutionBadgeProps {
  readonly status: NodeExecutionStatus;
  readonly attemptNumber?: number;
  /** Fork branch progress. When present on a running fork node, replaces the generic spinner. */
  readonly forkProgress?: ForkProgressInfo;
  /** Tool name awaiting approval. Displayed in the badge when status is waiting_approval. */
  readonly approvalToolName?: string;
  /** Live agent activity. When present on a running agent_call node, shows what the agent is doing. */
  readonly agentActivity?: AgentActivityInfo;
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
  agentActivity,
}: ExecutionBadgeProps) {
  if (status === "not_reached" || status === "pending") return null;

  // Approval-specific badge: show tool name when available.
  if (status === "waiting_approval" && approvalToolName) {
    const approvalLabel = `Awaiting approval: ${approvalToolName}`;
    return (
      <span
        className={cn(
          "stg:absolute stg:-right-1.5 stg:-top-1.5 stg:z-20 stg:flex stg:h-5 stg:items-center stg:gap-0.5 stg:rounded-full stg:px-1.5 stg:text-[10px] stg:font-semibold stg:leading-none stg:shadow-sm",
          "stg:bg-[var(--stgm-warning,#f59e0b)] stg:text-[var(--stgm-warning-foreground,#fff)]",
        )}
        title={approvalLabel}
        aria-label={approvalLabel}
      >
        ✋
        <span className="stg:max-w-[60px] stg:truncate">{approvalToolName}</span>
      </span>
    );
  }

  // Agent activity badge: show what the agent is doing (tool name or message count).
  if (status === "running" && agentActivity && (agentActivity.currentToolName || agentActivity.messagesCount > 0)) {
    const displayText = agentActivity.currentToolName || `${agentActivity.messagesCount} msgs`;
    const agentLabel = agentActivity.currentToolName
      ? `Agent using tool: ${agentActivity.currentToolName}`
      : `Agent: ${agentActivity.messagesCount} messages, ${agentActivity.toolCallsCount} tool calls`;

    return (
      <span
        className={cn(
          "stg:absolute stg:-right-1.5 stg:-top-1.5 stg:z-20 stg:flex stg:h-5 stg:items-center stg:gap-0.5 stg:rounded-full stg:px-1.5 stg:text-[10px] stg:font-semibold stg:leading-none stg:shadow-sm",
          "stg:bg-[var(--stgm-primary,#6366f1)] stg:text-[var(--stgm-primary-foreground,#fff)]",
        )}
        title={agentLabel}
        aria-label={agentLabel}
      >
        {agentActivity.currentToolName ? "🔧" : "💬"}
        <span className="stg:max-w-[60px] stg:truncate">{displayText}</span>
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
          "stg:absolute stg:-right-1.5 stg:-top-1.5 stg:z-20 stg:flex stg:h-5 stg:min-w-5 stg:items-center stg:justify-center stg:rounded-full stg:px-1.5 stg:text-[10px] stg:font-semibold stg:leading-none stg:shadow-sm",
          "stg:bg-[var(--stgm-primary,#6366f1)] stg:text-[var(--stgm-primary-foreground,#fff)]",
        )}
        title={progressLabel}
        aria-label={progressLabel}
      >
        {forkProgress.completed}/{forkProgress.total}
        {forkProgress.compete && <span className="stg:ml-0.5">⚡</span>}
      </span>
    );
  }

  const { icon, label, className } = BADGE_CONFIG[status];

  return (
    <span
      className={cn(
        "stg:absolute stg:-right-1.5 stg:-top-1.5 stg:z-20 stg:flex stg:h-5 stg:min-w-5 stg:items-center stg:justify-center stg:rounded-full stg:px-1 stg:text-[10px] stg:font-semibold stg:leading-none stg:shadow-sm",
        className,
      )}
      title={label + (attemptNumber && attemptNumber > 1 ? ` (attempt ${attemptNumber})` : "")}
      aria-label={label}
    >
      {icon}
      {status === "retrying" && attemptNumber != null && attemptNumber > 1 && (
        <span className="stg:ml-0.5">{attemptNumber}</span>
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
    className: "stg:bg-[var(--stgm-primary,#6366f1)] stg:text-[var(--stgm-primary-foreground,#fff)]",
  },
  completed: {
    icon: "✓",
    label: "Completed",
    className: "stg:bg-[var(--stgm-success,#22c55e)] stg:text-[var(--stgm-success-foreground,#fff)]",
  },
  failed: {
    icon: "✕",
    label: "Failed",
    className: "stg:bg-[var(--stgm-destructive,#ef4444)] stg:text-[var(--stgm-destructive-foreground,#fff)]",
  },
  skipped: {
    icon: "—",
    label: "Skipped",
    className: "stg:bg-[var(--stgm-muted,#e5e5e5)] stg:text-[var(--stgm-muted-foreground,#737373)]",
  },
  retrying: {
    icon: "↻",
    label: "Retrying",
    className: "stg:bg-[var(--stgm-warning,#f59e0b)] stg:text-[var(--stgm-warning-foreground,#fff)]",
  },
  waiting_approval: {
    icon: "✋",
    label: "Waiting for approval",
    className: "stg:bg-[var(--stgm-warning,#f59e0b)] stg:text-[var(--stgm-warning-foreground,#fff)]",
  },
};
