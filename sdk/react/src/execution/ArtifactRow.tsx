"use client";

// Session-model artifact list row: adapts an ExecutionArtifact + its download
// wiring onto the shared, data-model-agnostic ArtifactRowView.

import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { useMemo } from "react";
import {
  fromExecutionArtifact,
  type ArtifactRowItem,
} from "./artifact-row-item.js";
import { ArtifactRowView } from "./ArtifactRowView.js";
import { useArtifactDownload } from "./useArtifactDownload.js";

/** Props for {@link ArtifactRow}. */
export interface ArtifactRowProps {
  /** The execution artifact to render. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact — used to mint its download URL. */
  readonly executionId: string;
  /**
   * When `true`, another artifact in the list shares this artifact's display
   * `name` but has a different `sandbox_path`; the row renders the parent
   * directory as a muted subtitle to disambiguate. Typically supplied from
   * {@link SessionArtifactEntry.hasNameCollision}.
   */
  readonly hasNameCollision?: boolean;
  /** Single click / Enter / Space: open the artifact (a preview tab, or a modal). */
  readonly onOpen: () => void;
  /**
   * Double click: promote the artifact to a persistent (pinned) tab — see
   * {@link ArtifactRowViewProps.onActivate}. Omit in panel-less hosts.
   */
  readonly onActivate?: () => void;
  /** Additional CSS classes for the row's `<li>`. */
  readonly className?: string;
}

/**
 * The `ExecutionArtifact` host of the shared {@link ArtifactRowView}: it owns
 * the session model's identity and download mechanics (presigned URL minted
 * by `executionId` + `storageKey` via {@link useArtifactDownload}) and maps
 * the artifact onto the view-model. The workflow's `Artifact`-resource host is
 * `WorkflowArtifactRow` — same row UI, different data model (deliberately
 * unified only at the presentational layer).
 *
 * @see ArtifactsTab — session-panel facet (rows open editor-pane document tabs)
 * @see ArtifactsWidget — panel-less embeddable (rows open the preview modal)
 */
export function ArtifactRow({
  artifact,
  executionId,
  hasNameCollision = false,
  onOpen,
  onActivate,
  className,
}: ArtifactRowProps) {
  const { download, isDownloading } = useArtifactDownload(executionId);

  const item = useMemo<ArtifactRowItem>(
    () => fromExecutionArtifact(artifact, hasNameCollision),
    [artifact, hasNameCollision],
  );

  return (
    <ArtifactRowView
      item={item}
      onOpen={onOpen}
      onActivate={onActivate}
      onDownload={() => download(artifact.storageKey, artifact.name)}
      isDownloading={isDownloading}
      className={className}
    />
  );
}
