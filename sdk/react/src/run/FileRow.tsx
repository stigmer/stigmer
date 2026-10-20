"use client";

// A conversation's File row: adapts a File, its place and its download
// wiring onto the shared, data-model-agnostic FileRowView.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useMemo } from "react";
import { fromFile, type FileRowItem } from "./file-row-item.js";
import { FileRowView } from "./FileRowView.js";
import { useFileDownload } from "../file/useFile.js";

/** Props for {@link FileRow}. */
export interface FileRowProps {
  /** The File: one a turn returned, or one given to the conversation. */
  readonly file: StigmerFile;
  /**
   * Where the agent finds the File, relative to its folder, when it is not
   * the output path: a given File's settled mount path. The row is named
   * by its last segment.
   */
  readonly place?: string;
  /**
   * When `true`, another row shares this File's filename at a different
   * output path; the row renders the path's folder as a muted subtitle to
   * disambiguate. Typically supplied from
   * {@link SessionOutputEntry.hasNameCollision}.
   */
  readonly hasNameCollision?: boolean;
  /** Single click / Enter / Space: open the File (a preview tab, or a modal). */
  readonly onOpen: () => void;
  /**
   * Double click: promote the File to a persistent (pinned) tab — see
   * {@link FileRowViewProps.onActivate}. Omit in panel-less hosts.
   */
  readonly onActivate?: () => void;
  /** Additional CSS classes for the row's `<li>`. */
  readonly className?: string;
}

/**
 * The File host of the shared {@link FileRowView}: it owns the
 * download mechanics (a link minted per click via {@link useFileDownload})
 * and maps the File onto the view-model.
 *
 * @see FilesTab — session-panel facet (rows open editor-pane document tabs)
 */
export function FileRow({
  file,
  place,
  hasNameCollision = false,
  onOpen,
  onActivate,
  className,
}: FileRowProps) {
  const { download, isDownloading } = useFileDownload();

  const item = useMemo<FileRowItem>(
    () => fromFile(file, hasNameCollision, place),
    [file, hasNameCollision, place],
  );

  return (
    <FileRowView
      item={item}
      onOpen={onOpen}
      onActivate={onActivate}
      onDownload={() => download(file.metadata?.id ?? "", item.name)}
      isDownloading={isDownloading}
      className={className}
    />
  );
}
