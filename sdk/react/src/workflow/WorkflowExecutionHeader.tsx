"use client";

import { memo, useMemo, type ReactNode } from "react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionPhaseBadge } from "./WorkflowExecutionPhaseBadge.js";
import type { UseWorkflowExecutionActionsReturn } from "./useWorkflowExecutionActions.js";
import type { WorkflowEventStreamState, DerivedCostSummary } from "../internal/store/workflow-execution-event-store.js";
import { formatDuration, formatMicroUsd } from "./format-utils.js";

/** Props for {@link WorkflowExecutionHeader}. */
export interface WorkflowExecutionHeaderProps {
  readonly execution: WorkflowExecution;
  readonly streamState: WorkflowEventStreamState;
  readonly costSummary: DerivedCostSummary;
  readonly actions: UseWorkflowExecutionActionsReturn;
  /** Called when the user clicks "Diagnose with AI" on a failed execution. */
  readonly onDiagnose?: () => void;
  /** Whether the diagnosis panel is currently active. */
  readonly isDiagnosing?: boolean;
  /** Called when the user clicks "Compare with..." on a terminal execution. */
  readonly onCompare?: () => void;
  /**
   * Host-supplied action elements rendered at the trailing edge of the
   * header (e.g. a Share control). Kept routing/auth-agnostic per DD-004 —
   * the SDK renders the slot; the host owns its behavior.
   */
  readonly headerActions?: ReactNode;
  readonly className?: string;
}

const RUNNING_PHASES = new Set<ExecutionPhase>([
  ExecutionPhase.EXECUTION_PENDING,
  ExecutionPhase.EXECUTION_IN_PROGRESS,
]);

/**
 * Header bar for the workflow execution viewer showing phase badge,
 * execution name, duration, cost summary, and lifecycle action buttons.
 *
 * Action buttons are contextual:
 * - Running: Pause, Cancel
 * - Paused: Resume, Cancel
 * - Failed: Recover
 */
const TERMINAL_PHASES = new Set<ExecutionPhase>([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

export const WorkflowExecutionHeader = memo(function WorkflowExecutionHeader({
  execution,
  streamState,
  costSummary,
  actions,
  onDiagnose,
  isDiagnosing,
  onCompare,
  headerActions,
  className,
}: WorkflowExecutionHeaderProps) {
  const phase = execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const name = execution.metadata?.name ?? execution.metadata?.id ?? "Execution";
  const startedAt = execution.status?.startedAt ?? "";
  const completedAt = execution.status?.completedAt ?? "";

  const duration = useMemo(() => {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    return formatDuration(end - start);
  }, [startedAt, completedAt]);

  const costDisplay = useMemo(() => {
    if (costSummary.costConsumedMicros <= BigInt(0)) return null;
    return formatMicroUsd(costSummary.costConsumedMicros);
  }, [costSummary.costConsumedMicros]);

  const isRunning = RUNNING_PHASES.has(phase);
  const isPaused = phase === ExecutionPhase.EXECUTION_PAUSED;
  const isFailed = phase === ExecutionPhase.EXECUTION_FAILED;
  const isLive =
    streamState.stage === "streaming" ||
    streamState.stage === "connecting" ||
    streamState.stage === "reconnecting";

  return (
    <header className={cn("flex items-center gap-3 border-b border-border px-4 py-3", className)}>
      <WorkflowExecutionPhaseBadge phase={phase} />

      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {name}
      </h2>

      {duration && (
        <span className="shrink-0 text-xs text-muted-foreground">{duration}</span>
      )}

      {costDisplay && (
        <span className="shrink-0 text-xs text-muted-foreground">{costDisplay}</span>
      )}

      {isLive && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Live
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {onCompare && TERMINAL_PHASES.has(phase) && (
          <ActionButton
            label="Compare with…"
            onClick={onCompare}
            disabled={false}
          />
        )}

        {isRunning && (
          <>
            <ActionButton
              label="Pause"
              onClick={() => actions.pause()}
              disabled={actions.isSubmitting}
            />
            <ActionButton
              label="Cancel"
              variant="destructive"
              onClick={() => actions.cancel()}
              disabled={actions.isSubmitting}
            />
          </>
        )}

        {isPaused && (
          <>
            <ActionButton
              label="Resume"
              onClick={() => actions.resume()}
              disabled={actions.isSubmitting}
            />
            <ActionButton
              label="Cancel"
              variant="destructive"
              onClick={() => actions.cancel()}
              disabled={actions.isSubmitting}
            />
          </>
        )}

        {isFailed && (
          <>
            {onDiagnose && (
              <ActionButton
                label={isDiagnosing ? "Diagnosing…" : "Diagnose"}
                onClick={onDiagnose}
                disabled={actions.isSubmitting || !!isDiagnosing}
              />
            )}
            <ActionButton
              label="Recover"
              onClick={() => actions.recover()}
              disabled={actions.isSubmitting}
            />
          </>
        )}

        {headerActions && (
          <div className="relative flex items-center">{headerActions}</div>
        )}
      </div>
    </header>
  );
});

function ActionButton({
  label,
  variant,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly variant?: "destructive";
  readonly onClick: () => void;
  readonly disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded px-2 py-1 text-xs font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "destructive"
          ? "border border-destructive/30 text-destructive hover:bg-destructive/10"
          : "border border-border text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

