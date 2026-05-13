"use client";

import { memo, useMemo } from "react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionPhaseBadge } from "./WorkflowExecutionPhaseBadge";
import type { UseWorkflowExecutionActionsReturn } from "./useWorkflowExecutionActions";
import type { WorkflowEventStreamState, DerivedCostSummary } from "../internal/store/workflow-execution-event-store";

/** Props for {@link WorkflowExecutionHeader}. */
export interface WorkflowExecutionHeaderProps {
  readonly execution: WorkflowExecution;
  readonly streamState: WorkflowEventStreamState;
  readonly costSummary: DerivedCostSummary;
  readonly actions: UseWorkflowExecutionActionsReturn;
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
export const WorkflowExecutionHeader = memo(function WorkflowExecutionHeader({
  execution,
  streamState,
  costSummary,
  actions,
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
  const isLive = streamState.stage === "streaming" || streamState.stage === "connecting";

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
          <ActionButton
            label="Recover"
            onClick={() => actions.recover()}
            disabled={actions.isSubmitting}
          />
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function formatMicroUsd(micros: bigint): string {
  const cents = Number(micros) / 10_000;
  if (cents < 1) return `$${(Number(micros) / 1_000_000).toFixed(4)}`;
  return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}
