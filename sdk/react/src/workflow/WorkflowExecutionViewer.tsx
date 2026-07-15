"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskStatus, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { useWorkflowExecution } from "./useWorkflowExecution.js";
import { useWorkflowExecutionEventStream } from "./useWorkflowExecutionEventStream.js";
import { useWorkflowExecutionArtifacts } from "./useWorkflowExecutionArtifacts.js";
import {
  useWorkflowExecutionFileChanges,
  type UseWorkflowExecutionFileChangesReturn,
} from "./useWorkflowExecutionFileChanges.js";
import { useWorkflowExecutionActions } from "./useWorkflowExecutionActions.js";
import { WorkflowExecutionHeader } from "./WorkflowExecutionHeader.js";
import { WorkflowExecutionTimeline, type WorkflowExecutionTimelineProps } from "./WorkflowExecutionTimeline.js";
import { WaterfallTimeline } from "./waterfall/index.js";
import { WorkflowExecutionCostPanel } from "./WorkflowExecutionCostPanel.js";
import { WorkflowRepairCard } from "./WorkflowRepairCard.js";
import { WorkflowExecutionGraph } from "./WorkflowExecutionGraph.js";
import type { DerivedCostSummary, DerivedTaskState } from "../internal/store/workflow-execution-event-store.js";
import { ExecutionInspector } from "./execution-inspector/index.js";
import { ExecutionComparisonPicker } from "./execution-comparison/ExecutionComparisonPicker.js";
import { ExecutionComparisonView } from "./execution-comparison/ExecutionComparisonView.js";
import { WorkflowExecutionApprovalCard } from "./WorkflowExecutionApprovalCard.js";
import { WorkflowFileReviewList, type WorkflowFileDecisionSubmit } from "./WorkflowFileReviewList.js";
import type { WorkflowPendingApproval, WorkflowPendingFileReview } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ResizableSplit } from "../internal/ResizableSplit.js";
import { useWorkspaceEditors } from "../internal/store/index.js";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../execution/artifact-document.js";
import {
  FILE_CHANGE_DOCUMENT_ENTRY_ID,
  fileChangeTabPath,
} from "../execution/file-change-document.js";
import { FileChangeDiff } from "../execution/FileChangesView.js";
import {
  WorkspaceSurface,
  type SurfaceVirtualDocument,
} from "../workspace/WorkspaceSurface.js";
import { PanelChip } from "../workspace/PanelChip.js";
import {
  useWorkflowExecutionPanel,
  workflowArtifactTabPath,
  type WorkflowExecutionPanelController,
} from "./useWorkflowExecutionPanel.js";
import { useWorkflowExecutionRailViews } from "./useWorkflowExecutionRailViews.js";
import { WorkflowArtifactDocument } from "./WorkflowArtifactDocument.js";

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
  /** Additional action elements to render in the sidebar inspector footer. */
  readonly additionalActions?: ReactNode;
  /**
   * Host-supplied action elements rendered in the header action group
   * (e.g. a Share control). Routing/auth-agnostic per DD-004.
   */
  readonly headerActions?: ReactNode;
  /**
   * Whether task nodes in the execution graph can be dragged to
   * rearrange the layout for presentations. Drag positions are
   * ephemeral and not persisted.
   * @default false
   */
  readonly nodesDraggable?: boolean;
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
  headerActions,
  nodesDraggable,
  className,
}: WorkflowExecutionViewerProps) {
  const {
    execution,
    isLoading: isLoadingExecution,
    error: executionError,
    refetch: refetchExecution,
  } = useWorkflowExecution(executionId);

  const phase = execution?.status?.phase;
  const isRunning = phase === ExecutionPhase.EXECUTION_PENDING || phase === ExecutionPhase.EXECUTION_IN_PROGRESS;

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
        agentSlug: "",
        currentToolName: "",
        messagesCount: 0,
        toolCallsCount: 0,
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

  const { artifacts } = useWorkflowExecutionArtifacts(executionId);

  // File-change rollup across AGENT_CALL children (Changes facet). Owner-level
  // like the artifacts hook — the fetched children must survive panel
  // collapse/expand cycles (the panel's content unmounts while collapsed).
  const fileChangesState = useWorkflowExecutionFileChanges({
    executionId,
    taskStates: effectiveTaskStates,
    taskSnapshots: execution?.status?.tasks,
  });

  const actions = useWorkflowExecutionActions(executionId, {
    onSuccess: refetchExecution,
  });

  // The execution-level workspace panel (facets + virtual document
  // tabs). The controller lives at the owner level — the editors-store
  // SUBSCRIPTION stays inside ExecutionWorkspacePanel so tab churn re-renders
  // only the panel subtree, never the streaming graph (DD-009/DD-010).
  const panel = useWorkflowExecutionPanel();

  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const [showComparePicker, setShowComparePicker] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState<string | null>(null);

  const handleDiagnose = useCallback(() => {
    setShowDiagnosis(true);
  }, []);

  const handleCloseDiagnosis = useCallback(() => {
    setShowDiagnosis(false);
  }, []);

  const handleOpenComparePicker = useCallback(() => {
    setShowComparePicker(true);
  }, []);

  const handleCloseComparePicker = useCallback(() => {
    setShowComparePicker(false);
  }, []);

  const handleCompareConfirm = useCallback((compareId: string) => {
    setCompareTargetId(compareId);
    setShowComparePicker(false);
  }, []);

  const handleExitComparison = useCallback(() => {
    setCompareTargetId(null);
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
        onCompare={handleOpenComparePicker}
        headerActions={
          <>
            {headerActions}
            {/* The panel's always-mounted toggle — always-on now that the
                Usage facet gives the panel data-independent content (its
                empty state is honest even before any usage accrues). The
                badge stays the artifact count: artifacts are countable
                collateral, usage is a continuous quantity. */}
            <PanelChip
              isOpen={panel.isOpen}
              onToggle={panel.isOpen ? panel.closePanel : panel.openPanel}
              badgeCount={artifacts.length}
            />
          </>
        }
      />

      {/* Comparison picker dialog */}
      <ExecutionComparisonPicker
        open={showComparePicker}
        workflowId={execution.spec?.workflowId ?? execution.spec?.workflowInstanceId ?? ""}
        baseExecutionId={executionId}
        basePhase={phase ?? 0}
        onConfirm={handleCompareConfirm}
        onClose={handleCloseComparePicker}
      />

      {/* Action error banner — lifecycle actions only (cancel/terminate/pause/
          resume/recover). Approval failures are per-gate and surface in-card on
          the failing approval card, never here. */}
      {actions.error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2">
          <p className="flex-1 text-xs text-destructive">{actions.error.message}</p>
          <button
            type="button"
            onClick={actions.clearError}
            className="shrink-0 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Comparison view (replaces normal content when active) */}
      {compareTargetId ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ExecutionComparisonView
            baseExecutionId={executionId}
            compareExecutionId={compareTargetId}
            onBack={handleExitComparison}
          />
        </div>
      ) : (
      <>
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

      {/* Outer split: the graph-dominant content vs. the execution workspace
          panel. Toggling goes through `collapsedPane` (CSS, not conditional
          structure) so both children keep stable tree positions and an
          open/close never remounts the React Flow graph or reconnects the
          event stream (DD-009) — the same invariant the session viewer's
          panel split holds for its conversation. */}
      <ResizableSplit
        resizablePane="secondary"
        collapsedPane={panel.isOpen ? "none" : "secondary"}
        defaultSize={560}
        minSize={360}
        maxSize={960}
        storageKey="stgm-wf-exec-panel-width"
        ariaLabel="Resize execution panel"
        className="min-h-0 flex-1"
        primary={
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {/* Primary area: Execution graph + resizable inspector */}
        <ResizableSplit
          defaultSize={showDiagnosis ? 440 : 384}
          minSize={280}
          maxSize={800}
          storageKey="stgm-wf-exec-inspector-width"
          primary={
            <WorkflowExecutionGraph
              executionId={executionId}
              execution={execution}
              taskStates={effectiveTaskStates}
              onTaskSelect={setSelectedTaskName}
              onAutoSelectTask={setSelectedTaskName}
              followExecution={isRunning}
              nodesDraggable={nodesDraggable}
              className="h-full"
            />
          }
          secondary={
            <aside className="flex h-full flex-col overflow-hidden">
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
                    pendingApprovals={execution?.status?.pendingApprovals}
                    onSubmitApproval={actions.submitApproval}
                    approvalSubmittingToolCallIds={actions.approvalSubmittingToolCallIds}
                    approvalErrorsByToolCallId={actions.approvalErrorsByToolCallId}
                    onSubmitTaskApproval={actions.submitTaskApproval}
                    taskApprovalSubmittingTaskNames={actions.taskApprovalSubmittingTaskNames}
                    taskApprovalErrorsByTaskName={actions.taskApprovalErrorsByTaskName}
                    className="min-h-0 flex-1"
                  />

                  <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
                    <WorkflowExecutionCostPanel costSummary={costSummary} />
                  </div>

                  {additionalActions && (
                    <div className="border-t border-[var(--stgm-border,#e5e5e5)] px-3 py-2">
                      {additionalActions}
                    </div>
                  )}
                </div>
              )}
            </aside>
          }
        />

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
          taskApprovalSubmittingTaskNames={actions.taskApprovalSubmittingTaskNames}
          taskApprovalErrorsByTaskName={actions.taskApprovalErrorsByTaskName}
          pendingApprovals={execution?.status?.pendingApprovals}
          onSubmitApproval={actions.submitApproval}
          approvalSubmittingToolCallIds={actions.approvalSubmittingToolCallIds}
          approvalErrorsByToolCallId={actions.approvalErrorsByToolCallId}
          pendingFileReviews={execution?.status?.pendingFileReviews}
          onSubmitFileDecision={actions.submitFileDecision}
          fileDecisionSubmittingKeys={actions.fileDecisionSubmittingKeys}
          fileDecisionErrorsByKey={actions.fileDecisionErrorsByKey}
        />
      </div>
        }
        secondary={
          // Content unmounts while collapsed (matching the session panel
          // region); the editors store lives on the controller, so open tabs
          // survive a collapse/expand cycle.
          panel.isOpen ? (
            <ExecutionWorkspacePanel
              panel={panel}
              artifacts={artifacts}
              fileChangesState={fileChangesState}
              costSummary={costSummary}
              taskStates={effectiveTaskStates}
              onSelectTask={setSelectedTaskName}
            />
          ) : null
        }
      />
      </>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Execution workspace panel — WorkspaceSurface + facets (Artifacts/Changes/Usage)
// ---------------------------------------------------------------------------

/**
 * The workflow analog of the session viewer's panel region: subscribes to the
 * open-editor group (keeping that subscription out of the streaming owner),
 * assembles the rail facets, and resolves open virtual-document tabs back to
 * their records (artifact tabs → `Artifact`, file-change tabs → the current
 * net `FileChange`).
 */
function ExecutionWorkspacePanel({
  panel,
  artifacts,
  fileChangesState,
  costSummary,
  taskStates,
  onSelectTask,
}: {
  readonly panel: WorkflowExecutionPanelController;
  readonly artifacts: readonly Artifact[];
  readonly fileChangesState: UseWorkflowExecutionFileChangesReturn;
  readonly costSummary: DerivedCostSummary;
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  readonly onSelectTask: (taskName: string) => void;
}) {
  const { editors, activeFile } = useWorkspaceEditors(panel.editorsStore);

  // The Changes list highlights the row of the open diff tab — only a
  // file-change document's path counts (an artifact tab must not highlight a
  // coincidentally-named change).
  const activeFileChangePath =
    activeFile?.entryId === FILE_CHANGE_DOCUMENT_ENTRY_ID
      ? activeFile.path
      : null;

  const railViews = useWorkflowExecutionRailViews({
    artifacts,
    onOpenArtifact: panel.openArtifact,
    onActivateArtifact: panel.pinArtifact,
    fileChanges: fileChangesState.fileChanges,
    fileChangesLoading: fileChangesState.isLoading,
    fileChangesRefetching: fileChangesState.isRefetching,
    fileChangesError: fileChangesState.error,
    activeFileChangePath,
    onOpenFileChange: panel.openFileChange,
    costSummary,
    taskStates,
    onSelectTask,
  });

  // Resolve open artifact tabs to their records by the same tab-path identity
  // used to open them (single source of truth). A tab whose artifact vanished
  // (e.g. expired and dropped from a refetch) degrades to an honest notice
  // rather than vanishing.
  const artifactByTabPath = useMemo(
    () => new Map(artifacts.map((a) => [workflowArtifactTabPath(a), a])),
    [artifacts],
  );
  // File-change tabs resolve the same way: tab path → net FileChange. The
  // rollup is re-derived at task boundaries, so an open tab always renders
  // the CURRENT net diff for its path (never a stale copy captured at open
  // time); a path that dropped out of the rollup degrades to a notice.
  const fileChangeByTabPath = useMemo(
    () =>
      new Map(
        fileChangesState.fileChanges.map((c) => [fileChangeTabPath(c), c]),
      ),
    [fileChangesState.fileChanges],
  );
  const virtualDocuments = useMemo<readonly SurfaceVirtualDocument[]>(
    () =>
      editors
        .filter(
          (editor) =>
            editor.entryId === ARTIFACT_DOCUMENT_ENTRY_ID ||
            editor.entryId === FILE_CHANGE_DOCUMENT_ENTRY_ID,
        )
        .map((editor) => {
          if (editor.entryId === FILE_CHANGE_DOCUMENT_ENTRY_ID) {
            const change = fileChangeByTabPath.get(editor.path);
            return {
              entryId: FILE_CHANGE_DOCUMENT_ENTRY_ID,
              path: editor.path,
              content: change ? (
                <div className="mx-auto w-full max-w-5xl px-4 py-4">
                  <FileChangeDiff key={editor.path} change={change} />
                </div>
              ) : (
                <FileChangeUnavailableNotice />
              ),
            };
          }
          const artifact = artifactByTabPath.get(editor.path);
          return {
            entryId: ARTIFACT_DOCUMENT_ENTRY_ID,
            path: editor.path,
            content: artifact ? (
              <WorkflowArtifactDocument key={editor.path} artifact={artifact} />
            ) : (
              <ArtifactUnavailableNotice />
            ),
          };
        }),
    [editors, artifactByTabPath, fileChangeByTabPath],
  );

  return (
    <WorkspaceSurface
      entries={[]}
      lister={undefined}
      reader={undefined}
      // Facet-only rail until a workspace-source slice wires a lister —
      // inert Explorer/Search icons would be dishonest chrome here.
      builtInViews={[]}
      view={panel.view}
      onViewChange={panel.setView}
      extraViews={railViews}
      virtualDocuments={virtualDocuments}
      editors={editors}
      selectedFile={activeFile}
      onOpenFile={panel.openFile}
      onActivateEditor={panel.activateEditor}
      onPinEditor={panel.pinEditor}
      onCloseEditor={panel.closeEditor}
      onCollapse={panel.closePanel}
      className="h-full"
    />
  );
}

function FileChangeUnavailableNotice() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-8 text-center"
    >
      <p className="text-xs font-medium text-foreground">
        This file change is no longer available.
      </p>
      <p className="text-xs text-muted-foreground">
        The rollup was refreshed and this file no longer appears among the
        execution&apos;s changes.
      </p>
    </div>
  );
}

function ArtifactUnavailableNotice() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-8 text-center"
    >
      <p className="text-xs font-medium text-foreground">
        This artifact is no longer available.
      </p>
      <p className="text-xs text-muted-foreground">
        It may have expired or been removed from storage.
      </p>
    </div>
  );
}

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
// Tabbed bottom panel: Waterfall + Event Log + Approvals
// ---------------------------------------------------------------------------

type BottomTab = "waterfall" | "events" | "approvals";

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
  taskApprovalSubmittingTaskNames,
  taskApprovalErrorsByTaskName,
  pendingApprovals,
  onSubmitApproval,
  approvalSubmittingToolCallIds,
  approvalErrorsByToolCallId,
  pendingFileReviews,
  onSubmitFileDecision,
  fileDecisionSubmittingKeys,
  fileDecisionErrorsByKey,
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
  taskApprovalSubmittingTaskNames: ReadonlySet<string>;
  taskApprovalErrorsByTaskName: ReadonlyMap<string, Error>;
  pendingApprovals?: readonly WorkflowPendingApproval[];
  onSubmitApproval?: (toolCallId: string, action: ApprovalAction, comment?: string) => Promise<unknown>;
  approvalSubmittingToolCallIds: ReadonlySet<string>;
  approvalErrorsByToolCallId: ReadonlyMap<string, Error>;
  pendingFileReviews?: readonly WorkflowPendingFileReview[];
  onSubmitFileDecision: WorkflowFileDecisionSubmit;
  fileDecisionSubmittingKeys: ReadonlySet<string>;
  fileDecisionErrorsByKey: ReadonlyMap<string, Error>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomTab>("waterfall");
  const prevHitlCountRef = useRef(0);

  const approvalCount = pendingApprovals?.length ?? 0;
  const fileReviewCount = pendingFileReviews?.length ?? 0;
  // Both HITL kinds (tool approvals + file reviews) share the one "Approvals" tab.
  const hitlCount = approvalCount + fileReviewCount;
  const hasHitl = hitlCount > 0;

  // Auto-switch to the Approvals tab when a new HITL gate (approval or file
  // review) arrives; leave it when everything is resolved.
  useEffect(() => {
    if (hitlCount > prevHitlCountRef.current && hitlCount > 0) {
      setActiveTab("approvals");
      setCollapsed(false);
    }
    if (hitlCount === 0 && activeTab === "approvals") {
      setActiveTab("waterfall");
    }
    prevHitlCountRef.current = hitlCount;
  }, [hitlCount, activeTab]);

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
        {hasHitl && (
          <TabButton
            label={`Approvals (${hitlCount})`}
            isActive={activeTab === "approvals"}
            onClick={() => { setActiveTab("approvals"); setCollapsed(false); }}
          />
        )}
      </div>

      {/* Panel content */}
      {!collapsed && (
        <div className="h-52">
          {activeTab === "waterfall" && (
            <WaterfallTimeline
              events={events}
              streamState={streamState}
              executionStartIso={executionStartIso}
              executionDurationMs={executionDurationMs}
              selectedTaskName={selectedTaskName}
              onTaskSelect={onTaskSelect}
              className="h-full"
            />
          )}
          {activeTab === "events" && (
            <WorkflowExecutionTimeline
              events={events}
              streamState={streamState}
              onNavigateToAgentExecution={onNavigateToAgentExecution}
              taskStates={taskStates}
              onSubmitTaskApproval={onSubmitTaskApproval}
              taskApprovalSubmittingTaskNames={taskApprovalSubmittingTaskNames}
              taskApprovalErrorsByTaskName={taskApprovalErrorsByTaskName}
              className="h-full"
            />
          )}
          {activeTab === "approvals" && (
            <div className="h-full overflow-y-auto px-4 py-3">
              <div className="space-y-3">
                {pendingApprovals && onSubmitApproval && pendingApprovals.map((pa) => {
                  const toolCallId = pa.approval?.toolCallId ?? "";
                  return (
                    <WorkflowExecutionApprovalCard
                      key={toolCallId || pa.childAgentExecutionId}
                      prompt={pa.approval?.message || `Tool "${pa.approval?.toolName}" requires approval`}
                      toolCallId={toolCallId}
                      approvers={[]}
                      timeoutSeconds={0}
                      onSubmitApproval={onSubmitApproval}
                      isSubmitting={approvalSubmittingToolCallIds.has(toolCallId)}
                      error={approvalErrorsByToolCallId.get(toolCallId) ?? null}
                    />
                  );
                })}
                {pendingFileReviews && pendingFileReviews.length > 0 && (
                  <WorkflowFileReviewList
                    pendingFileReviews={pendingFileReviews}
                    onSubmitFileDecision={onSubmitFileDecision}
                    submittingDecisionKeys={fileDecisionSubmittingKeys}
                    decisionErrors={fileDecisionErrorsByKey}
                    onNavigateToAgentExecution={onNavigateToAgentExecution}
                  />
                )}
              </div>
            </div>
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
