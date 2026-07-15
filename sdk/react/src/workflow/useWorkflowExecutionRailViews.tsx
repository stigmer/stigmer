"use client";

// Assembles the workflow execution panel's facets as WorkspaceSurface rail
// views. Domain: workflow (the analog of session/useSessionRailViews).

import { useMemo } from "react";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTask, WorkflowPendingApproval } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../internal/store/workflow-execution-event-store.js";
import type { SurfaceRailView } from "../workspace/WorkspaceSurface.js";
import { WorkflowArtifactsTab } from "./facets/WorkflowArtifactsTab.js";
import { WorkflowChangesTab } from "./facets/WorkflowChangesTab.js";
import { WorkflowUsageTab } from "./facets/WorkflowUsageTab.js";
import { ExecutionInspector } from "./execution-inspector/index.js";
import type { UseWorkflowExecutionActionsReturn } from "./useWorkflowExecutionActions.js";

/**
 * The HITL wiring for the Inspect facet: the slice of
 * {@link UseWorkflowExecutionActionsReturn} the inspector's Approval tab
 * needs to decide agent-tool and `human_input` gates.
 *
 * A `Pick` (not a new shape) so the bundle can never drift from the actions
 * hook — the same idiom as the transcript document's
 * `WorkflowAgentExecutionHitl`. The viewer builds it from its single
 * `useWorkflowExecutionActions` instance, so a gate's in-flight/error state
 * is identical wherever that gate is shown (Inspect facet, transcript,
 * bottom Approvals tab).
 */
export type WorkflowInspectHitl = Pick<
  UseWorkflowExecutionActionsReturn,
  | "submitApproval"
  | "approvalSubmittingToolCallIds"
  | "approvalErrorsByToolCallId"
  | "submitTaskApproval"
  | "taskApprovalSubmittingTaskNames"
  | "taskApprovalErrorsByTaskName"
>;

/**
 * Inputs for the contextual Inspect rail view — the per-task detail facet.
 * Grouped (and memoized by the caller) so the rail assembly re-derives the
 * Inspect element only when its own inputs move, never on unrelated churn.
 */
export interface WorkflowInspectViewOptions {
  /** The selected task the facet inspects. The view exists only with one. */
  readonly selectedTaskName: string | null;
  /** All events from the execution event stream (per-task event log). */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Task snapshots from `execution.status.tasks` for full I/O data. */
  readonly taskSnapshots?: readonly WorkflowTask[];
  /** Pending agent tool approvals from `execution.status.pending_approvals`. */
  readonly pendingApprovals?: readonly WorkflowPendingApproval[];
  /** Navigate to a child agent execution as a standalone page (DD-004). */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /** Open an AGENT_CALL child's transcript in the panel's editor area. */
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  /** Approval/decision wiring — see {@link WorkflowInspectHitl}. */
  readonly hitl: WorkflowInspectHitl;
}

/** Options for {@link useWorkflowExecutionRailViews}. */
export interface UseWorkflowExecutionRailViewsOptions {
  /**
   * Inputs for the Inspect facet. When provided AND a task is selected, an
   * Inspect view leads the rail; omitted (standalone panel embeds), the
   * rail carries the execution-level facets only.
   */
  readonly inspect?: WorkflowInspectViewOptions;
  /** Artifacts produced by the execution — drives the Artifacts facet. */
  readonly artifacts: readonly Artifact[];
  /** Open an artifact as an editor-pane document tab (preview slot). */
  readonly onOpenArtifact: (artifact: Artifact) => void;
  /** Pin an artifact's document tab — the double-click half of open/activate. */
  readonly onActivateArtifact?: (artifact: Artifact) => void;
  /** Net file changes across all tasks — drives the Changes facet. */
  readonly fileChanges: readonly FileChange[];
  /** First-load state of the file-change rollup (Changes facet skeleton). */
  readonly fileChangesLoading?: boolean;
  /** Background-refresh state of the file-change rollup. */
  readonly fileChangesRefetching?: boolean;
  /** Child-fetch error for the Changes facet, or `null`. */
  readonly fileChangesError?: Error | null;
  /** Tab path of the active file-change diff document (active-row highlight). */
  readonly activeFileChangePath?: string | null;
  /** Open a file change's diff as an editor-pane document tab (preview slot). */
  readonly onOpenFileChange: (change: FileChange) => void;
  /** Execution-level cost/budget rollup — drives the Usage facet's summary. */
  readonly costSummary: DerivedCostSummary;
  /** Per-task derived states — drives the Usage facet's per-task breakdown. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Select a task in the host viewer from a Usage breakdown row. */
  readonly onSelectTask?: (taskName: string) => void;
}

/**
 * Composes the workflow execution facets as {@link SurfaceRailView}s for the
 * workspace surface's activity rail — the workflow-domain half of the panel,
 * mirroring `useSessionRailViews` (domain-specific assembler over the
 * domain-pure surface).
 *
 * The Inspect view is CONTEXTUAL (present only while a task is selected —
 * the session's rule for its selection-driven view) and `fitted`: the
 * inspector owns its header, tab strip, and scroll, so the surface hands it
 * a bare slot instead of the shared facet envelope. The execution-level
 * facets (Artifacts/Changes/Usage) are ALWAYS offered while the panel
 * renders (the session gates its execution facets behind
 * `includeExecutionFacets` only for the pre-session launcher — the workflow
 * viewer has no such pre-execution state). Empty data is handled by each
 * facet's empty state, not by dropping the view: an empty rail would strand
 * the surface's view fallback on nothing.
 */
export function useWorkflowExecutionRailViews({
  inspect,
  artifacts,
  onOpenArtifact,
  onActivateArtifact,
  fileChanges,
  fileChangesLoading,
  fileChangesRefetching,
  fileChangesError,
  activeFileChangePath,
  onOpenFileChange,
  costSummary,
  taskStates,
  onSelectTask,
}: UseWorkflowExecutionRailViewsOptions): readonly SurfaceRailView[] {
  // The Inspect element is derived separately from the execution-level
  // facets: selection changes must not re-create the facet elements, and
  // facet-input changes must not re-create the inspector element (DD-010 —
  // the surface mounts only the active view, but stable refs keep memoized
  // subtrees intact when the arrays recombine).
  const inspectView = useMemo((): SurfaceRailView | null => {
    if (!inspect || inspect.selectedTaskName === null) return null;
    return {
      id: "inspect",
      label: "Inspect",
      icon: <InspectIcon />,
      // The inspector is the fully self-managing view the `fitted` slot
      // exists for: its own header strip, tab strip, and internal scroll —
      // rendered UNCHANGED from its previous life as the standalone aside.
      fitted: true,
      content: (
        <ExecutionInspector
          selectedTaskName={inspect.selectedTaskName}
          events={inspect.events}
          taskStates={taskStates}
          taskSnapshots={inspect.taskSnapshots}
          onNavigateToAgentExecution={inspect.onNavigateToAgentExecution}
          onOpenAgentExecution={inspect.onOpenAgentExecution}
          pendingApprovals={inspect.pendingApprovals}
          onSubmitApproval={inspect.hitl.submitApproval}
          approvalSubmittingToolCallIds={
            inspect.hitl.approvalSubmittingToolCallIds
          }
          approvalErrorsByToolCallId={inspect.hitl.approvalErrorsByToolCallId}
          onSubmitTaskApproval={inspect.hitl.submitTaskApproval}
          taskApprovalSubmittingTaskNames={
            inspect.hitl.taskApprovalSubmittingTaskNames
          }
          taskApprovalErrorsByTaskName={
            inspect.hitl.taskApprovalErrorsByTaskName
          }
          className="min-h-0 flex-1"
        />
      ),
    };
  }, [inspect, taskStates]);

  const facetViews = useMemo(
    (): readonly SurfaceRailView[] => [
      {
        id: "artifacts",
        label: "Artifacts",
        icon: <ArtifactsIcon />,
        badge: artifacts.length > 0 ? artifacts.length : undefined,
        content: (
          <WorkflowArtifactsTab
            artifacts={artifacts}
            onOpen={onOpenArtifact}
            onActivate={onActivateArtifact}
          />
        ),
      },
      {
        id: "changes",
        label: "Changes",
        icon: <ChangesIcon />,
        badge: fileChanges.length > 0 ? fileChanges.length : undefined,
        content: (
          <WorkflowChangesTab
            fileChanges={fileChanges}
            isLoading={fileChangesLoading}
            isRefetching={fileChangesRefetching}
            error={fileChangesError}
            activePath={activeFileChangePath}
            onOpen={onOpenFileChange}
          />
        ),
      },
      {
        // No badge (matching the session's Usage view) — cost is a
        // continuous quantity, not a countable collection.
        id: "usage",
        label: "Usage",
        icon: <UsageIcon />,
        content: (
          <WorkflowUsageTab
            costSummary={costSummary}
            taskStates={taskStates}
            onSelectTask={onSelectTask}
          />
        ),
      },
    ],
    [
      artifacts,
      onOpenArtifact,
      onActivateArtifact,
      fileChanges,
      fileChangesLoading,
      fileChangesRefetching,
      fileChangesError,
      activeFileChangePath,
      onOpenFileChange,
      costSummary,
      taskStates,
      onSelectTask,
    ],
  );

  // Inspect leads the rail: it is the per-node landing view the primary
  // gesture (a DAG node click) targets; the execution-level facets follow.
  return useMemo(
    () => (inspectView ? [inspectView, ...facetViews] : facetViews),
    [inspectView, facetViews],
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — monochrome, `currentColor`-tinted (DD-005; SDK
// independence — no lucide dependency). Same glyph as the session rail's
// Artifacts view, so the two panels read identically.
// ---------------------------------------------------------------------------

/**
 * Same crosshair glyph as the session rail's Inspect view — the two panels'
 * selection-driven facets are the same idea and must read identically.
 */
function InspectIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

function ArtifactsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v9" />
    </svg>
  );
}

/**
 * File-diff glyph (document with +/- lines) — deliberately NOT the session
 * rail's branch glyph: that Changes view shows git write-backs, while this
 * one shows file diffs, and reusing the glyph would imply the same content.
 */
function ChangesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4" />
      <path d="M10 11h4" />
      <path d="M12 9v4" />
      <path d="M10 16.5h4" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 20h18" />
      <path d="M6 20v-6" />
      <path d="M11 20V9" />
      <path d="M16 20v-9" />
      <path d="M21 20V5" />
    </svg>
  );
}
