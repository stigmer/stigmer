"use client";

// Assembles the workflow execution panel's facets as WorkspaceSurface rail
// views. Domain: workflow (the analog of session/useSessionRailViews).

import { useMemo } from "react";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { SurfaceRailView } from "../workspace/WorkspaceSurface.js";
import { WorkflowArtifactsTab } from "./facets/WorkflowArtifactsTab.js";

/** Options for {@link useWorkflowExecutionRailViews}. */
export interface UseWorkflowExecutionRailViewsOptions {
  /** Artifacts produced by the execution — drives the Artifacts facet. */
  readonly artifacts: readonly Artifact[];
  /** Open an artifact as an editor-pane document tab (preview slot). */
  readonly onOpenArtifact: (artifact: Artifact) => void;
  /** Pin an artifact's document tab — the double-click half of open/activate. */
  readonly onActivateArtifact?: (artifact: Artifact) => void;
}

/**
 * Composes the workflow execution facets as {@link SurfaceRailView}s for the
 * workspace surface's activity rail — the workflow-domain half of the panel,
 * mirroring `useSessionRailViews` (domain-specific assembler over the
 * domain-pure surface).
 *
 * This slice carries the Artifacts facet only; Usage/Changes/Inspect are
 * later parity slices. Artifacts is ALWAYS offered while the panel renders —
 * it is the panel's only view, and an empty rail would strand the surface's
 * view fallback on nothing. The empty-artifacts case is handled by the
 * facet's empty state (and by the viewer gating its toggle chip), not by
 * dropping the view.
 */
export function useWorkflowExecutionRailViews({
  artifacts,
  onOpenArtifact,
  onActivateArtifact,
}: UseWorkflowExecutionRailViewsOptions): readonly SurfaceRailView[] {
  return useMemo(
    () => [
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
    ],
    [artifacts, onOpenArtifact, onActivateArtifact],
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
