"use client";

import { memo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowExecution } from "./useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "./useWorkflowExecutionEventStream";
import { useWorkflowExecutionArtifacts } from "./useWorkflowExecutionArtifacts";
import { useWorkflowExecutionActions } from "./useWorkflowExecutionActions";
import { WorkflowExecutionHeader } from "./WorkflowExecutionHeader";
import { WorkflowExecutionTimeline } from "./WorkflowExecutionTimeline";
import { WorkflowExecutionTaskPanel } from "./WorkflowExecutionTaskPanel";
import { WorkflowExecutionCostPanel } from "./WorkflowExecutionCostPanel";
import { WorkflowExecutionArtifactPanel } from "./WorkflowExecutionArtifactPanel";

/** Props for {@link WorkflowExecutionViewer}. */
export interface WorkflowExecutionViewerProps {
  /** ID of the workflow execution to display. */
  readonly executionId: string;
  /**
   * Callback when the user clicks a link to a child agent execution.
   * Receives the AgentExecution ID. The host application is responsible
   * for navigation — this keeps the component routing-agnostic (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
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
  onNavigateToAgentExecution,
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

  const {
    artifacts,
    isLoading: isLoadingArtifacts,
  } = useWorkflowExecutionArtifacts(executionId);

  const actions = useWorkflowExecutionActions(executionId);

  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

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

      <div className="flex min-h-0 flex-1">
        {/* Main area: Event timeline */}
        <WorkflowExecutionTimeline
          events={events}
          streamState={streamState}
          onNavigateToAgentExecution={onNavigateToAgentExecution}
          className="flex-1 border-r border-border"
        />

        {/* Sidebar */}
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto">
          <WorkflowExecutionTaskPanel
            taskStates={taskStates}
            totalTasks={totalTasks}
            selectedTaskName={selectedTaskName}
            onSelectTask={setSelectedTaskName}
          />

          <div className="border-t border-border">
            <WorkflowExecutionCostPanel costSummary={costSummary} />
          </div>

          {artifacts.length > 0 && (
            <div className="border-t border-border">
              <WorkflowExecutionArtifactPanel artifacts={artifacts} />
            </div>
          )}

          {additionalActions && (
            <div className="border-t border-border px-3 py-2">
              {additionalActions}
            </div>
          )}
        </aside>
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
