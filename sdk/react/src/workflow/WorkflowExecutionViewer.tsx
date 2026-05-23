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
import { WaterfallTimeline } from "./waterfall";
import { WorkflowExecutionCostPanel } from "./WorkflowExecutionCostPanel";
import { WorkflowExecutionArtifactPanel } from "./WorkflowExecutionArtifactPanel";
import { WorkflowRepairCard } from "./WorkflowRepairCard";
import { WorkflowExecutionGraph } from "./WorkflowExecutionGraph";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";
import { ExecutionInspector } from "./execution-inspector";

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

  const executionDurationMs = useMemo(() => {
    const startedAt = execution?.status?.startedAt;
    const completedAt = execution?.status?.completedAt;
    if (startedAt && completedAt) {
      return new Date(completedAt).getTime() - new Date(startedAt).getTime();
    }
    return undefined;
  }, [execution?.status?.startedAt, execution?.status?.completedAt]);

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
          {/* Execution graph — primary view (T04), dedup: shares execution + taskStates */}
          <WorkflowExecutionGraph
            executionId={executionId}
            execution={execution}
            taskStates={effectiveTaskStates}
            onTaskSelect={setSelectedTaskName}
            onAutoSelectTask={setSelectedTaskName}
            className="flex-1"
          />

          {/* Right panel — runtime inspector or diagnosis */}
          <aside
            className={cn(
              "flex shrink-0 flex-col overflow-hidden border-l border-[var(--stgm-border,#e5e5e5)]",
              showDiagnosis
                ? "w-[40%] min-w-[360px] max-w-[500px]"
                : "w-80 lg:w-96",
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ExecutionInspector
                  selectedTaskName={selectedTaskName}
                  events={events}
                  taskStates={effectiveTaskStates}
                  taskSnapshots={execution?.status?.tasks ?? undefined}
                  onNavigateToAgentExecution={onNavigateToAgentExecution}
                  className="min-h-0 flex-1"
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
              </div>
            )}
          </aside>
        </div>

        {/* Bottom panel: Waterfall (default) + Event Log tabs */}
        <ExecutionBottomPanel
          events={events}
          streamState={streamState}
          executionStartIso={execution.status?.startedAt ?? ""}
          executionDurationMs={executionDurationMs}
          selectedTaskName={selectedTaskName}
          onTaskSelect={setSelectedTaskName}
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
// Tabbed bottom panel: Waterfall + Event Log (T07)
// ---------------------------------------------------------------------------

type BottomTab = "waterfall" | "events";

function ExecutionBottomPanel({
  events,
  streamState,
  executionStartIso,
  executionDurationMs,
  selectedTaskName,
  onTaskSelect,
  onNavigateToAgentExecution,
  taskStates,
  onSubmitTaskApproval,
  isSubmittingApproval,
}: {
  events: WorkflowExecutionTimelineProps["events"];
  streamState: WorkflowExecutionTimelineProps["streamState"];
  executionStartIso: string;
  executionDurationMs?: number;
  selectedTaskName: string | null;
  onTaskSelect: (taskName: string) => void;
  onNavigateToAgentExecution?: (id: string) => void;
  taskStates: ReadonlyMap<string, DerivedTaskState>;
  onSubmitTaskApproval: WorkflowExecutionTimelineProps["onSubmitTaskApproval"];
  isSubmittingApproval: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomTab>("waterfall");

  return (
    <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-[var(--stgm-border,#e5e5e5)]">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
          aria-label={collapsed ? "Expand bottom panel" : "Collapse bottom panel"}
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
        </button>

        <TabButton
          label="Waterfall"
          isActive={activeTab === "waterfall"}
          onClick={() => { setActiveTab("waterfall"); setCollapsed(false); }}
        />
        <TabButton
          label={`Events (${events.length})`}
          isActive={activeTab === "events"}
          onClick={() => { setActiveTab("events"); setCollapsed(false); }}
        />
      </div>

      {/* Panel content */}
      {!collapsed && (
        <div className="h-52">
          {activeTab === "waterfall" ? (
            <WaterfallTimeline
              events={events}
              streamState={streamState}
              executionStartIso={executionStartIso}
              executionDurationMs={executionDurationMs}
              selectedTaskName={selectedTaskName}
              onTaskSelect={onTaskSelect}
              className="h-full"
            />
          ) : (
            <WorkflowExecutionTimeline
              events={events}
              streamState={streamState}
              onNavigateToAgentExecution={onNavigateToAgentExecution}
              taskStates={taskStates}
              onSubmitTaskApproval={onSubmitTaskApproval}
              isSubmittingApproval={isSubmittingApproval}
              className="h-full"
            />
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
}: {
  readonly label: string;
  readonly isActive: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs font-medium transition-colors",
        isActive
          ? "border-b-2 border-[var(--stgm-primary,#3b82f6)] text-[var(--stgm-foreground,#171717)]"
          : "text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-foreground,#171717)]",
      )}
    >
      {label}
    </button>
  );
}
