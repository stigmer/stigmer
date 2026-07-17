"use client";

// Assembles the workflow execution panel's facets as WorkspaceSurface rail
// views. Domain: workflow (the analog of session/useSessionRailViews).

import { useMemo } from "react";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../internal/store/workflow-execution-event-store.js";
import type { SurfaceRailView } from "../workspace/WorkspaceSurface.js";
import { WorkflowArtifactsTab } from "./facets/WorkflowArtifactsTab.js";
import { WorkflowChangesTab } from "./facets/WorkflowChangesTab.js";
import { WorkflowUsageTab } from "./facets/WorkflowUsageTab.js";

/** Options for {@link useWorkflowExecutionRailViews}. */
export interface UseWorkflowExecutionRailViewsOptions {
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
}

/**
 * Composes the workflow execution facets as {@link SurfaceRailView}s for the
 * workspace surface's activity rail — the workflow-domain half of the panel,
 * mirroring `useSessionRailViews` (domain-specific assembler over the
 * domain-pure surface).
 *
 * The panel carries the execution-level facets only (Artifacts / Changes /
 * Usage): per-task detail lives on the thread cards, the single home for a
 * task's data (T06 — the Inspect drill-down is gone). The facets are ALWAYS
 * offered while the panel renders (the session gates its execution facets
 * behind `includeExecutionFacets` only for the pre-session launcher — the
 * workflow viewer has no such pre-execution state). Empty data is handled by
 * each facet's empty state, not by dropping the view: an empty rail would
 * strand the surface's view fallback on nothing.
 */
export function useWorkflowExecutionRailViews({
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
}: UseWorkflowExecutionRailViewsOptions): readonly SurfaceRailView[] {
  return useMemo(
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
          <WorkflowUsageTab costSummary={costSummary} taskStates={taskStates} />
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
    ],
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — monochrome, `currentColor`-tinted (DD-005; SDK
// independence — no lucide dependency). Same glyph as the session rail's
// Artifacts view, so the two panels read identically.
// ---------------------------------------------------------------------------

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
