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
    <header className={cn("stg:flex stg:items-center stg:gap-3 stg:border-b stg:border-border stg:px-4 stg:py-3", className)}>
      <WorkflowExecutionPhaseBadge phase={phase} />

      <h2 className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
        {name}
      </h2>

      {duration && (
        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">{duration}</span>
      )}

      {costDisplay && (
        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">{costDisplay}</span>
      )}

      {isLive && (
        <span className="stg:flex stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground">
          <span className="stg:relative stg:flex stg:h-1.5 stg:w-1.5">
            <span className="stg:absolute stg:inline-flex stg:h-full stg:w-full stg:animate-ping stg:rounded-full stg:bg-success stg:opacity-75" />
            <span className="stg:relative stg:inline-flex stg:h-1.5 stg:w-1.5 stg:rounded-full stg:bg-success" />
          </span>
          Live
        </span>
      )}

      <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
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
          <div className="stg:relative stg:flex stg:items-center">{headerActions}</div>
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
        "stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        variant === "destructive"
          ? "stg:border stg:border-destructive/30 stg:text-destructive stg:hover:bg-destructive/10"
          : "stg:border stg:border-border stg:text-foreground stg:hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

