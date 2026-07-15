"use client";

// Artifacts facet for the workflow execution panel's activity rail.
// Domain: workflow (the Artifact-resource analog of session/facets/ArtifactsTab).

import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { useMemo } from "react";
import { ArtifactRowView } from "../../execution/ArtifactRowView.js";
import type { ArtifactRowItem } from "../../execution/artifact-row-item.js";
import { deriveWorkflowArtifactItems } from "../deriveWorkflowArtifactItems.js";
import { useWorkflowArtifactDownload } from "../useWorkflowArtifactDownload.js";

/** Props for {@link WorkflowArtifactsTab}. */
export interface WorkflowArtifactsTabProps {
  /** Artifacts produced by the execution (from `useWorkflowExecutionArtifacts`). */
  readonly artifacts: readonly Artifact[];
  /** Single click / Enter / Space: open the artifact as an editor-pane document tab. */
  readonly onOpen: (artifact: Artifact) => void;
  /**
   * Double click: pin the artifact's document tab — the double-click half of
   * the open/activate split (mirrors the file tree's preview/pin model).
   */
  readonly onActivate?: (artifact: Artifact) => void;
}

/**
 * Artifacts facet for the workflow execution panel (a
 * `useWorkflowExecutionRailViews` rail view): a VS Code-style dense list of
 * the execution's outputs across ALL tasks (data/http/llm/agent — the
 * server aggregates via `listByExecution`), one row per artifact.
 *
 * Clicking a row opens the artifact as an editor-pane document
 * (`WorkflowArtifactDocument`); the hover Download mints a fresh URL. Rows
 * share `ArtifactRowView` with the session's Artifacts facet — one row UI
 * over two deliberately-separate artifact data models.
 */
export function WorkflowArtifactsTab({
  artifacts,
  onOpen,
  onActivate,
}: WorkflowArtifactsTabProps) {
  const entries = useMemo(
    () => deriveWorkflowArtifactItems(artifacts),
    [artifacts],
  );

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          No artifacts yet. Files produced by workflow tasks will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col">
      {entries.map(({ artifact, item }) => (
        <WorkflowArtifactRow
          key={artifact.metadata?.id ?? item.name}
          artifact={artifact}
          item={item}
          onOpen={() => onOpen(artifact)}
          onActivate={onActivate ? () => onActivate(artifact) : undefined}
        />
      ))}
    </ul>
  );
}

/**
 * The `Artifact`-resource host of the shared `ArtifactRowView`: it owns the
 * workflow model's download mechanics (URL minted by artifact id). Internal —
 * hosts compose the facet, not individual rows.
 */
function WorkflowArtifactRow({
  artifact,
  item,
  onOpen,
  onActivate,
}: {
  readonly artifact: Artifact;
  readonly item: ArtifactRowItem;
  readonly onOpen: () => void;
  readonly onActivate?: () => void;
}) {
  const { download, isDownloading } = useWorkflowArtifactDownload();

  return (
    <ArtifactRowView
      item={item}
      onOpen={onOpen}
      onActivate={onActivate}
      onDownload={() => download(artifact.metadata?.id ?? "")}
      isDownloading={isDownloading}
    />
  );
}
