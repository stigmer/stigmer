"use client";

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { useWorkflowExecution } from "./useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "./useWorkflowExecutionEventStream";
import { useWorkflowExecutionArtifacts } from "./useWorkflowExecutionArtifacts";
import { useWorkflowExecutionActions } from "./useWorkflowExecutionActions";
import { WorkflowExecutionHeader } from "./WorkflowExecutionHeader";
import { WorkflowExecutionTimeline, type WorkflowExecutionTimelineProps } from "./WorkflowExecutionTimeline";
import { WorkflowExecutionTaskPanel } from "./WorkflowExecutionTaskPanel";
import { WorkflowExecutionCostPanel } from "./WorkflowExecutionCostPanel";
import { WorkflowExecutionArtifactPanel } from "./WorkflowExecutionArtifactPanel";
import { WorkflowRepairCard } from "./WorkflowRepairCard";
import { WorkflowExecutionGraph } from "./WorkflowExecutionGraph";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";

/** Props for {@link WorkflowExecutionViewer}. */
export interface WorkflowExecutionViewerProps {
  /** ID of the workflow execution to display. */
  readonly executionId: string;
  /** Organization slug — needed for AI diagnosis authorization. */
  readonly org?: string;
  /**
   * Callback when the user clicks a link to a child agent execution.
   * Receives the AgentExecution ID. The host application is responsible
   * for navigation — this keeps the component routing-agnostic (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /**
   * Callback when the user clicks "Apply Fix" in the repair card.
   * Receives the suggested YAML and the workflow slug. The host
   * application handles navigation to the workflow editor (DD-004).
   */
  readonly onNavigateToWorkflowEditor?: (yaml: string, workflowSlug: string) => void;
  /** Additional action elements to render in the header. */
  readonly additionalActions?: ReactNode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Top-level composed viewer for a single workflow execution.
 *
 * Wires together all execution hooks and sub-components into a
 * two-region layout: an event timeline (main area) and a context
 * sidebar (tasks, budget, artifacts).
 *
 * This component is designed to work identically whether rendered
 * in the Stigmer Console or embedded in a third-party dashboard.
 * No dependencies on Console routing, auth, or layout context.
 *
 * @example
 * ```tsx
 * <WorkflowExecutionViewer
 *   executionId="wfx_abc123"
 *   onNavigateToAgentExecution={(id) => router.push(`/sessions/${id}`)}
 * />
 * ```
 */
export const WorkflowExecutionViewer = memo(function WorkflowExecutionViewer({
  executionId,
  org,
  onNavigateToAgentExecution,
  onNavigateToWorkflowEditor,
  additionalActions,
  className,
}: WorkflowExecutionViewerProps) {
  const {
    execution,
    isLoading: isLoadingExecution,
    error: executionError,
    refetch: refetchExecution,
  } = useWorkflowExecution(executionId);

  const phase = execution?.status?.phase;

  const {
    events,
    taskStates,
    costSummary,
    streamState,
    totalTasks,
    error: streamError,
    reconnect,
  } = useWorkflowExecutionEventStream(executionId, {
    executionPhase: phase,
  });

  // Fallback: when the event log is empty but the execution has task status
  // snapshots (e.g., due to event persistence failure), derive task states
  // from the status.tasks array so the panel is never completely blank.
  const fallbackTaskStates = useMemo((): ReadonlyMap<string, DerivedTaskState> | null => {
    if (events.length > 0 || streamState.stage !== "complete") return null;
    const tasks = execution?.status?.tasks;
    if (!tasks || tasks.length === 0) return null;

    const map = new Map<string, DerivedTaskState>();
    for (const t of tasks) {
      const name = t.taskName;
      if (!name) continue;

      let status: DerivedTaskState["status"] = "pending";
      switch (t.status) {
        case WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS:
          status = "running";
          break;
        case WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED:
          status = "completed";
          break;
        case WorkflowTaskStatus.WORKFLOW_TASK_FAILED:
          status = "failed";
          break;
        case WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED:
          status = "skipped";
          break;
        case WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL:
          status = "waiting_approval";
          break;
        default:
          status = "pending";
      }

      let durationMs = 0;
      if (t.startedAt && t.completedAt) {
        durationMs = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
      }

      map.set(name, {
        taskName: name,
        taskKind: WorkflowTaskKind.workflow_task_kind_unspecified,
        status,
        durationMs,
        costMicros: BigInt(0),
        tokensUsed: BigInt(0),
        attemptNumber: 1,
        error: t.error ?? "",
        childExecutionId: "",
      });
    }
    return map;
  }, [events.length, streamState.stage, execution?.status?.tasks]);

  const effectiveTaskStates = fallbackTaskStates ?? taskStates;
  const effectiveTotalTasks = fallbackTaskStates ? fallbackTaskStates.size : totalTasks;

  const {
    artifacts,
    isLoading: isLoadingArtifacts,
  } = useWorkflowExecutionArtifacts(executionId);

  const actions = useWorkflowExecutionActions(executionId);

  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
  const [showDiagnosis, setShowDiagnosis] = useState(false);

  const handleDiagnose = useCallback(() => {
    setShowDiagnosis(true);
  }, []);

  const handleCloseDiagnosis = useCallback(() => {
    setShowDiagnosis(false);
  }, []);

  const handleApplyFix = useCallback(
    (yaml: string) => {
      if (onNavigateToWorkflowEditor) {
        const slug = execution?.metadata?.slug ?? execution?.metadata?.name ?? "";
        onNavigateToWorkflowEditor(yaml, slug);
      }
    },
    [onNavigateToWorkflowEditor, execution],
  );

  // Loading state
  if (isLoadingExecution) {
    return (
      <div className={cn("flex h-full items-center justify-center", className)}>
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (executionError) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-3 px-6", className)}>
        <p className="text-sm text-destructive">{executionError.message}</p>
        <button
          type="button"
          onClick={refetchExecution}
          className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  // Not found
  if (!execution) {
    return (
      <div className={cn("flex h-full items-center justify-center text-sm text-muted-foreground", className)}>
        Execution not found
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      <WorkflowExecutionHeader
        execution={execution}
        streamState={streamState}
        costSummary={costSummary}
        actions={actions}
        onDiagnose={org ? handleDiagnose : undefined}
        isDiagnosing={showDiagnosis}
      />

      {/* Stream error banner */}
      {streamError && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2">
          <p className="flex-1 text-xs text-destructive">{streamError.message}</p>
          <button
            type="button"
            onClick={reconnect}
            className="shrink-0 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            Reconnect
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Primary area: Execution graph + inspector stub */}
        <div className="flex min-h-0 flex-1">
          {/* Execution graph — primary view (T04) */}
          <WorkflowExecutionGraph
            executionId={executionId}
            onTaskSelect={setSelectedTaskName}
            className="flex-1"
          />

          {/* Right panel — inspector stub or diagnosis */}
          <aside
            className={cn(
              "flex shrink-0 flex-col overflow-hidden border-l border-[var(--stgm-border,#e5e5e5)]",
              showDiagnosis
                ? "w-[40%] min-w-[360px] max-w-[500px]"
                : "w-64 overflow-y-auto",
            )}
          >
            {showDiagnosis && org ? (
              <WorkflowRepairCard
                executionId={executionId}
                org={org}
                onApplyFix={onNavigateToWorkflowEditor ? handleApplyFix : undefined}
                onClose={handleCloseDiagnosis}
                className="h-full"
              />
            ) : (
              <>
                {/* Inspector stub — shows selected task context (full inspector in T05) */}
                <ExecutionInspectorStub
                  selectedTaskName={selectedTaskName}
                  taskStates={effectiveTaskStates}
                />

                <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
                  <WorkflowExecutionCostPanel costSummary={costSummary} />
                </div>

                {artifacts.length > 0 && (
                  <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
                    <WorkflowExecutionArtifactPanel artifacts={artifacts} />
                  </div>
                )}

                {additionalActions && (
                  <div className="border-t border-[var(--stgm-border,#e5e5e5)] px-3 py-2">
                    {additionalActions}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>

        {/* Collapsible bottom panel: Event timeline */}
        <TimelinePanel
          events={events}
          streamState={streamState}
          onNavigateToAgentExecution={onNavigateToAgentExecution}
          taskStates={effectiveTaskStates}
          onSubmitTaskApproval={actions.submitTaskApproval}
          isSubmittingApproval={actions.isSubmitting}
        />
      </div>
    </div>
  );
});

function LoadingSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3 p-6">
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-3 animate-pulse rounded-full bg-muted" />
            <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector stub (T04) — full inspector comes in T05
// ---------------------------------------------------------------------------

function ExecutionInspectorStub({
  selectedTaskName,
  taskStates,
}: {
  selectedTaskName: string | null;
  taskStates: ReadonlyMap<string, DerivedTaskState>;
}) {
  if (!selectedTaskName) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
        <p className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
          Select a node to view execution details
        </p>
      </div>
    );
  }

  const state = taskStates.get(selectedTaskName);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--stgm-foreground,#1a1a2e)]">
          {selectedTaskName}
        </h3>
        {state && (
          <span
            className={cn(
              "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
              state.status === "completed" && "bg-[var(--stgm-success,#22c55e)]/10 text-[var(--stgm-success,#22c55e)]",
              state.status === "failed" && "bg-[var(--stgm-destructive,#ef4444)]/10 text-[var(--stgm-destructive,#ef4444)]",
              state.status === "running" && "bg-[var(--stgm-primary,#6366f1)]/10 text-[var(--stgm-primary,#6366f1)]",
              state.status === "waiting_approval" && "bg-[var(--stgm-warning,#f59e0b)]/10 text-[var(--stgm-warning,#f59e0b)]",
              (state.status === "pending" || state.status === "retrying" || state.status === "skipped") &&
                "bg-[var(--stgm-muted,#e5e5e5)] text-[var(--stgm-muted-foreground,#737373)]",
            )}
          >
            {state.status.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {state && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {state.durationMs > 0 && (
            <>
              <dt className="text-[var(--stgm-muted-foreground,#737373)]">Duration</dt>
              <dd className="text-[var(--stgm-foreground,#1a1a2e)]">{formatDuration(state.durationMs)}</dd>
            </>
          )}
          {state.attemptNumber > 1 && (
            <>
              <dt className="text-[var(--stgm-muted-foreground,#737373)]">Attempt</dt>
              <dd className="text-[var(--stgm-foreground,#1a1a2e)]">{state.attemptNumber}</dd>
            </>
          )}
          {state.error && (
            <>
              <dt className="text-[var(--stgm-muted-foreground,#737373)]">Error</dt>
              <dd className="text-[var(--stgm-destructive,#ef4444)] break-words">{state.error}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

// ---------------------------------------------------------------------------
// Collapsible timeline panel (T04)
// ---------------------------------------------------------------------------

function TimelinePanel({
  events,
  streamState,
  onNavigateToAgentExecution,
  taskStates,
  onSubmitTaskApproval,
  isSubmittingApproval,
}: {
  events: WorkflowExecutionTimelineProps["events"];
  streamState: WorkflowExecutionTimelineProps["streamState"];
  onNavigateToAgentExecution?: (id: string) => void;
  taskStates: ReadonlyMap<string, DerivedTaskState>;
  onSubmitTaskApproval: WorkflowExecutionTimelineProps["onSubmitTaskApproval"];
  isSubmittingApproval: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={cn("transition-transform", !collapsed && "rotate-180")}
          aria-hidden="true"
        >
          <path d="M2 4L5 7L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Event Timeline ({events.length} events)
      </button>

      {!collapsed && (
        <WorkflowExecutionTimeline
          events={events}
          streamState={streamState}
          onNavigateToAgentExecution={onNavigateToAgentExecution}
          taskStates={taskStates}
          onSubmitTaskApproval={onSubmitTaskApproval}
          isSubmittingApproval={isSubmittingApproval}
          className="h-64 border-t border-[var(--stgm-border,#e5e5e5)]"
        />
      )}
    </div>
  );
}
