"use client";

// Session-model artifact list row: adapts an output File and its download
// wiring onto the shared, data-model-agnostic ArtifactRowView.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useMemo } from "react";
import { fromFile, type ArtifactRowItem } from "./artifact-row-item.js";
import { ArtifactRowView } from "./ArtifactRowView.js";
import { useFileDownload } from "../file/useFile.js";

/** Props for {@link ArtifactRow}. */
export interface ArtifactRowProps {
  /** The File a turn returned. */
  readonly file: StigmerFile;
  /**
   * When `true`, another row shares this File's filename at a different
   * output path; the row renders the path's folder as a muted subtitle to
   * disambiguate. Typically supplied from
   * {@link SessionArtifactEntry.hasNameCollision}.
   */
  readonly hasNameCollision?: boolean;
  /** Single click / Enter / Space: open the File (a preview tab, or a modal). */
  readonly onOpen: () => void;
  /**
   * Double click: promote the File to a persistent (pinned) tab — see
   * {@link ArtifactRowViewProps.onActivate}. Omit in panel-less hosts.
   */
  readonly onActivate?: () => void;
  /** Additional CSS classes for the row's `<li>`. */
  readonly className?: string;
}

/**
 * The output-File host of the shared {@link ArtifactRowView}: it owns the
 * download mechanics (a link minted per click via {@link useFileDownload})
 * and maps the File onto the view-model.
 *
 * @see ArtifactsTab — session-panel facet (rows open editor-pane document tabs)
 */
export function ArtifactRow({
  file,
  hasNameCollision = false,
  onOpen,
  onActivate,
  className,
}: ArtifactRowProps) {
  const { download, isDownloading } = useFileDownload();

  const item = useMemo<ArtifactRowItem>(
    () => fromFile(file, hasNameCollision),
    [file, hasNameCollision],
  );

  return (
    <ArtifactRowView
      item={item}
      onOpen={onOpen}
      onActivate={onActivate}
      onDownload={() => download(file.metadata?.id ?? "", item.name)}
      isDownloading={isDownloading}
      className={className}
    />
  );
}
