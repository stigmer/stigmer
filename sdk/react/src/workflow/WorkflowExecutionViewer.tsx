"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskStatus, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
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
import { WorkflowRepairCard } from "./WorkflowRepairCard.js";
import { WorkflowExecutionGraph } from "./WorkflowExecutionGraph.js";
import type { DerivedCostSummary, DerivedTaskState } from "../internal/store/workflow-execution-event-store.js";
import { ExecutionComparisonPicker } from "./execution-comparison/ExecutionComparisonPicker.js";
import { ExecutionComparisonView } from "./execution-comparison/ExecutionComparisonView.js";
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
import {
  DIAGNOSIS_DOCUMENT_ENTRY_ID,
  DIAGNOSIS_DOCUMENT_PATH,
} from "./diagnosis-document.js";
import { WorkflowArtifactDocument } from "./WorkflowArtifactDocument.js";
import {
  WorkflowTaskThread,
  type WorkflowThreadHitl,
} from "./thread/WorkflowTaskThread.js";
import { useExecutionAnnouncements } from "./useExecutionAnnouncements.js";
import {
  useApprovalBoundary,
  type ApprovalBoundaryCrossing,
} from "./useApprovalBoundary.js";

// ---------------------------------------------------------------------------
// Center-column view (S9: Thread | Graph toggle; Thread is the default)
// ---------------------------------------------------------------------------

/** The center-column view of the execution viewer. */
type CenterView = "thread" | "graph";

// Versioned key (S9). The unversioned S8 key is deliberately ABANDONED, not
// migrated: S8 shipped the thread as an opt-in preview with Graph as the
// default, so a stored S8 value records exploration of that preview — not a
// deliberate preference against the thread-primary product direction. The
// version bump gives every user one fresh landing on the new default;
// choices made from there persist.
const CENTER_VIEW_STORAGE_KEY = "stgm-wf-exec-center-view.v2";
const LEGACY_CENTER_VIEW_STORAGE_KEY = "stgm-wf-exec-center-view";

/**
 * Read the persisted center view, defaulting to the thread (the T02
 * thread-primary pivot). Same lazy-`useState` + `localStorage` pattern as
 * `ResizableSplit`'s persisted width.
 */
function readStoredCenterView(): CenterView {
  try {
    const stored = localStorage.getItem(CENTER_VIEW_STORAGE_KEY);
    if (stored === "thread" || stored === "graph") return stored;
  } catch {
    /* localStorage may be unavailable */
  }
  return "thread";
}

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
 * Wires together all execution hooks and sub-components into a two-column
 * layout: the center column (the session-style task thread by default, with
 * the DAG graph behind a view toggle — a passive visualization) and a single
 * collapsible `WorkspaceSurface` panel carrying the execution-level facets
 * (Artifacts/Changes/Usage on the rail) and the rich documents (transcripts,
 * diffs, artifacts, AI diagnosis in the editor area). A task's detail —
 * preview, I/O, errors, and every HITL decision surface — lives on its
 * thread card, the single home for task data (T06).
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
        // No event log → no truncated summaries and no gate record. The
        // card body still renders full I/O from this same snapshot
        // (`status.tasks[]`), so the fallback path is never a blank card
        // (T04); a decided human_input degrades to its raw output there.
        inputSummary: null,
        outputSummary: null,
        approvalRequest: null,
        approvalResolution: null,
      });
    }
    return map;
  }, [events.length, streamState.stage, execution?.status?.tasks]);

  const effectiveTaskStates = fallbackTaskStates ?? taskStates;
  const effectiveTotalTasks = fallbackTaskStates ? fallbackTaskStates.size : totalTasks;

  // Per-task snapshot lookup for the thread cards' I/O bodies (T04): an
  // O(1) map, rebuilt only when the snapshot refetches — never on stream
  // event appends — so memoized cards keep bailing during streaming.
  const taskSnapshotsByName = useMemo(():
    | ReadonlyMap<string, WorkflowTask>
    | undefined => {
    const tasks = execution?.status?.tasks;
    if (!tasks || tasks.length === 0) return undefined;
    const map = new Map<string, WorkflowTask>();
    for (const t of tasks) {
      if (t.taskName) map.set(t.taskName, t);
    }
    return map;
  }, [execution?.status?.tasks]);

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

  // The thread's HITL bundle (T06/T07) — ONE bundle from the single actions
  // instance, covering all three gate kinds: the child-gate fields (which
  // the thread hands to gating agent-call cards' inline transcripts, as the
  // `WorkflowAgentExecutionHitl` subset) plus the task-level (human_input)
  // approval wiring. Deps are the individual fields (DD-010): the bundle's
  // ref must survive unrelated churn on `actions` (a lifecycle action's
  // isSubmitting flip), and the thread scopes it to gating cards, so a
  // decision's in-flight flip re-renders the gating card only.
  const threadHitl = useMemo<WorkflowThreadHitl>(
    () => ({
      submitApproval: actions.submitApproval,
      approvalSubmittingToolCallIds: actions.approvalSubmittingToolCallIds,
      approvalErrorsByToolCallId: actions.approvalErrorsByToolCallId,
      submitFileDecision: actions.submitFileDecision,
      fileDecisionSubmittingKeys: actions.fileDecisionSubmittingKeys,
      fileDecisionErrorsByKey: actions.fileDecisionErrorsByKey,
      submitTaskApproval: actions.submitTaskApproval,
      taskApprovalSubmittingTaskNames: actions.taskApprovalSubmittingTaskNames,
      taskApprovalErrorsByTaskName: actions.taskApprovalErrorsByTaskName,
    }),
    [
      actions.submitApproval,
      actions.approvalSubmittingToolCallIds,
      actions.approvalErrorsByToolCallId,
      actions.submitFileDecision,
      actions.fileDecisionSubmittingKeys,
      actions.fileDecisionErrorsByKey,
      actions.submitTaskApproval,
      actions.taskApprovalSubmittingTaskNames,
      actions.taskApprovalErrorsByTaskName,
    ],
  );

  // The execution-level workspace panel (facets + virtual document
  // tabs). The controller lives at the owner level — the editors-store
  // SUBSCRIPTION stays inside ExecutionWorkspacePanel so tab churn re-renders
  // only the panel subtree, never the streaming graph (DD-009/DD-010).
  const panel = useWorkflowExecutionPanel();

  const [showComparePicker, setShowComparePicker] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState<string | null>(null);

  // Center-column view (S8/S9). Both views stay mounted with the inactive
  // one CSS-hidden — the `collapsedPane` discipline — so toggling never
  // remounts React Flow or drops the event stream (DD-009).
  const [centerView, setCenterView] = useState<CenterView>(readStoredCenterView);
  const handleCenterViewChange = useCallback((view: CenterView) => {
    setCenterView(view);
    try {
      localStorage.setItem(CENTER_VIEW_STORAGE_KEY, view);
    } catch {
      /* quota or security error */
    }
  }, []);

  // One-time cleanup of the abandoned S8 key (an effect, not the read path —
  // reads must stay side-effect-free).
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_CENTER_VIEW_STORAGE_KEY);
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  // Screen reader announcements for task state changes. Owned by the viewer
  // (not the graph): `display:none` removes content from the accessibility
  // tree, so a live region inside the CSS-hidden graph would go silent in
  // Thread view. One always-visible announcer serves both center views.
  const announcement = useExecutionAnnouncements(effectiveTaskStates);

  // Boundary-transition snapshot refetches. The snapshot fetch is one-shot
  // (`useWorkflowExecution` never polls), so the stream store's stage
  // transitions are the only live signals that the mount snapshot went
  // stale — the snapshot's own `phase` cannot be the trigger, since it
  // only moves on a refetch (the circularity behind the stale "Pending"
  // header, R1-5). Two transitions matter, one per direction:
  //
  // - ENTERING "complete" (T04, DD-T04-4): while a run streams, the cards'
  //   collapsed lines and bodies work from the TRUNCATED event summaries;
  //   the full per-task output lands on `status.tasks[]` only when the
  //   runner persists the terminal snapshot.
  // - ENTERING "streaming" (oss#571): the store flips connecting→streaming
  //   on the FIRST delivered event, so this transition is the "run
  //   started" signal for a page that landed on a still-pending execution
  //   — without the refetch, the phase badge and the phase-gated
  //   Pause/Cancel would freeze at "Pending" for the entire run. It also
  //   covers reconnecting→streaming, where the snapshot slept through the
  //   outage.
  //
  // Both are TRANSITION-scoped (never fire on mount): a terminal-replay
  // mount starts at "complete" and a mid-run mount starts at "streaming",
  // and each already fetched a fresh snapshot.
  const prevStreamStageRef = useRef(streamState.stage);
  useEffect(() => {
    const prev = prevStreamStageRef.current;
    prevStreamStageRef.current = streamState.stage;
    const enteredComplete =
      streamState.stage === "complete" &&
      (prev === "streaming" || prev === "reconnecting");
    const enteredStreaming =
      streamState.stage === "streaming" && prev !== "streaming";
    if (enteredComplete || enteredStreaming) {
      refetchExecution();
    }
  }, [streamState.stage, refetchExecution]);

  // Snapshot freshness across HITL boundaries (S9, the drawer's
  // replacement). A `waiting_approval` boundary crossing — in EITHER
  // direction — means the mount snapshot's gate lists are stale → refetch
  // (stale-while-revalidate; no skeleton): the thread's in-card gates read
  // those lists. No auto-select accompanies it (T06 — selection is gone):
  // the gating card is amber, carries its decision surface, and the aria
  // announcer + auto-follow + jump-to-latest cover attention. Gated on
  // `isRunning` so terminal-execution history replay (which crosses the
  // boundary for long-decided gates) never refetches.
  const handleApprovalBoundary = useCallback(
    (_crossing: ApprovalBoundaryCrossing) => {
      refetchExecution();
    },
    [refetchExecution],
  );
  useApprovalBoundary(effectiveTaskStates, isRunning, handleApprovalBoundary);

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
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center", className)}>
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (executionError) {
    return (
      <div className={cn("stg:flex stg:h-full stg:flex-col stg:items-center stg:justify-center stg:gap-3 stg:px-6", className)}>
        <p className="stg:text-sm stg:text-destructive">{executionError.message}</p>
        <button
          type="button"
          onClick={refetchExecution}
          className="stg:rounded stg:border stg:border-border stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-foreground stg:hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  // Not found
  if (!execution) {
    return (
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center stg:text-sm stg:text-muted-foreground", className)}>
        Execution not found
      </div>
    );
  }

  return (
    <div className={cn("stg:flex stg:h-full stg:flex-col stg:overflow-hidden", className)}>
      <WorkflowExecutionHeader
        execution={execution}
        streamState={streamState}
        costSummary={costSummary}
        actions={actions}
        // Diagnose opens (or focuses) the singleton diagnosis document tab —
        // the tab itself is the "diagnosis is active" state, so there is no
        // owner-level isDiagnosing boolean to keep in sync (SSOT).
        onDiagnose={org ? panel.openDiagnosis : undefined}
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
        <div className="stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-destructive/20 stg:bg-destructive/5 stg:px-4 stg:py-2">
          <p className="stg:flex-1 stg:text-xs stg:text-destructive">{actions.error.message}</p>
          <button
            type="button"
            onClick={actions.clearError}
            className="stg:shrink-0 stg:rounded stg:border stg:border-destructive/30 stg:px-2 stg:py-1 stg:text-xs stg:text-destructive stg:hover:bg-destructive/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Comparison view (replaces normal content when active) */}
      {compareTargetId ? (
        <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:p-4">
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
        <div className="stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-destructive/20 stg:bg-destructive/5 stg:px-4 stg:py-2">
          <p className="stg:flex-1 stg:text-xs stg:text-destructive">{streamError.message}</p>
          <button
            type="button"
            onClick={reconnect}
            className="stg:shrink-0 stg:rounded stg:border stg:border-destructive/30 stg:px-2 stg:py-1 stg:text-xs stg:text-destructive stg:hover:bg-destructive/10"
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
        className="stg:min-h-0 stg:flex-1"
        primary={
      <div className="stg:flex stg:h-full stg:min-h-0 stg:flex-1 stg:flex-col">
        {/* Center-column view switcher (S8). Graph is the default; the
            thread is the session-style card-per-task view (T02 pivot). */}
        <CenterViewSwitcher view={centerView} onChange={handleCenterViewChange} />

        {/* One always-visible live region for task state changes — see the
            ownership note on `announcement` above. */}
        <div role="log" aria-live="polite" aria-atomic="false" className="stg:sr-only">
          {announcement}
        </div>

        {/* Primary area: thread and graph, both mounted, inactive one
            CSS-hidden (stable tree positions — no React Flow remount, no
            stream reconnect, expanded cards survive a toggle). The thread
            card is the single home for a task's detail (T06); the graph is
            a passive topology visualization. */}
        <div
          data-center-view="thread"
          className={cn("stg:min-h-0 stg:flex-1", centerView !== "thread" && "stg:hidden")}
        >
          <WorkflowTaskThread
            taskStates={effectiveTaskStates}
            totalTasks={effectiveTotalTasks}
            isRunning={isRunning}
            onNavigateToAgentExecution={onNavigateToAgentExecution}
            // In-card HITL (S10/T06/T07): all three gate kinds decide on
            // the gating card — human_input on the card itself, child tool
            // approvals and file reviews inside the card's inline child
            // transcript (which streams them from the child directly).
            hitl={threadHitl}
            // Full per-task I/O for the card bodies (T04) — an O(1)
            // per-card snapshot lookup.
            taskSnapshotsByName={taskSnapshotsByName}
            className="stg:h-full"
          />
        </div>
        <div
          data-center-view="graph"
          className={cn("stg:min-h-0 stg:flex-1", centerView !== "graph" && "stg:hidden")}
        >
          <WorkflowExecutionGraph
            executionId={executionId}
            execution={execution}
            taskStates={effectiveTaskStates}
            // Gated on the graph being visible: camera moves against a
            // display:none (zero-size) viewport are degenerate.
            followExecution={isRunning && centerView === "graph"}
            // The viewer owns the one always-visible announcer above; the
            // graph's own would go silent while CSS-hidden in Thread view.
            announceTaskStates={false}
            nodesDraggable={nodesDraggable}
            className="stg:h-full"
          />
        </div>
      </div>
        }
        secondary={
          // Content unmounts while collapsed (matching the session panel
          // region); the editors store lives on the controller, so open tabs
          // survive a collapse/expand cycle.
          panel.isOpen ? (
            <ExecutionWorkspacePanel
              panel={panel}
              executionId={executionId}
              org={org}
              artifacts={artifacts}
              fileChangesState={fileChangesState}
              costSummary={costSummary}
              taskStates={effectiveTaskStates}
              onApplyFix={onNavigateToWorkflowEditor ? handleApplyFix : undefined}
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
 * net `FileChange`, the diagnosis tab → `WorkflowRepairCard`). Child
 * transcripts are NOT a document family here — since T07 they render inline
 * in the thread's agent-call cards.
 */
function ExecutionWorkspacePanel({
  panel,
  executionId,
  org,
  artifacts,
  fileChangesState,
  costSummary,
  taskStates,
  onApplyFix,
}: {
  readonly panel: WorkflowExecutionPanelController;
  readonly executionId: string;
  readonly org?: string;
  readonly artifacts: readonly Artifact[];
  readonly fileChangesState: UseWorkflowExecutionFileChangesReturn;
  readonly costSummary: DerivedCostSummary;
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** "Apply Fix" from the diagnosis document — host-routed (DD-004). */
  readonly onApplyFix?: (yaml: string) => void;
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
            editor.entryId === FILE_CHANGE_DOCUMENT_ENTRY_ID ||
            editor.entryId === DIAGNOSIS_DOCUMENT_ENTRY_ID,
        )
        .map((editor) => {
          if (editor.entryId === DIAGNOSIS_DOCUMENT_ENTRY_ID) {
            // The singleton AI-diagnosis conversation (opened by the header's
            // Diagnose button via `panel.openDiagnosis`). Keyed by the fixed
            // path so the streaming diagnosis flow survives unrelated editor
            // churn; its close button closes the tab — the tab IS the
            // "diagnosis is active" state.
            return {
              entryId: DIAGNOSIS_DOCUMENT_ENTRY_ID,
              path: editor.path,
              content: (
                <WorkflowRepairCard
                  key={editor.path}
                  executionId={executionId}
                  org={org ?? ""}
                  onApplyFix={onApplyFix}
                  onClose={() =>
                    panel.closeEditor(
                      DIAGNOSIS_DOCUMENT_ENTRY_ID,
                      DIAGNOSIS_DOCUMENT_PATH,
                    )
                  }
                />
              ),
            };
          }
          if (editor.entryId === FILE_CHANGE_DOCUMENT_ENTRY_ID) {
            const change = fileChangeByTabPath.get(editor.path);
            return {
              entryId: FILE_CHANGE_DOCUMENT_ENTRY_ID,
              path: editor.path,
              content: change ? (
                <div className="stg:mx-auto stg:w-full stg:max-w-5xl stg:px-4 stg:py-4">
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
    [
      editors,
      artifactByTabPath,
      fileChangeByTabPath,
      executionId,
      org,
      onApplyFix,
      panel.closeEditor,
    ],
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
      className="stg:h-full"
    />
  );
}

function FileChangeUnavailableNotice() {
  return (
    <div
      role="status"
      className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:items-center stg:gap-1 stg:px-4 stg:py-8 stg:text-center"
    >
      <p className="stg:text-xs stg:font-medium stg:text-foreground">
        This file change is no longer available.
      </p>
      <p className="stg:text-xs stg:text-muted-foreground">
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
      className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:items-center stg:gap-1 stg:px-4 stg:py-8 stg:text-center"
    >
      <p className="stg:text-xs stg:font-medium stg:text-foreground">
        This artifact is no longer available.
      </p>
      <p className="stg:text-xs stg:text-muted-foreground">
        It may have expired or been removed from storage.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="stg:flex stg:w-full stg:flex-col stg:gap-3 stg:p-6">
      <div className="stg:h-4 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
      <div className="stg:h-3 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted" />
      <div className="stg:mt-4 stg:space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="stg:flex stg:items-center stg:gap-3">
            <div className="stg:size-3 stg:animate-pulse stg:rounded-full stg:bg-muted" />
            <div className="stg:h-3 stg:flex-1 stg:animate-pulse stg:rounded stg:bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Center-column view switcher (S9: Thread | Graph — thread-primary order)
// ---------------------------------------------------------------------------

/**
 * Slim segmented control above the center column. A radiogroup (the two
 * views are mutually exclusive), matching the facet rail's radio semantics.
 * Thread leads: it is the primary view (T02 pivot); the DAG is the
 * secondary, topology-oriented lens.
 */
function CenterViewSwitcher({
  view,
  onChange,
}: {
  readonly view: CenterView;
  readonly onChange: (view: CenterView) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Center view"
      className="stg:flex stg:items-center stg:gap-0.5 stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:px-2 stg:py-1"
    >
      <CenterViewButton
        label="Thread"
        isActive={view === "thread"}
        onClick={() => onChange("thread")}
      />
      <CenterViewButton
        label="Graph"
        isActive={view === "graph"}
        onClick={() => onChange("graph")}
      />
    </div>
  );
}

function CenterViewButton({
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
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      className={cn(
        "stg:rounded stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium stg:transition-colors",
        isActive
          ? "stg:bg-[var(--stgm-muted,#f5f5f5)] stg:text-[var(--stgm-foreground,#171717)]"
          : "stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:text-[var(--stgm-foreground,#171717)]",
      )}
    >
      {label}
    </button>
  );
}

