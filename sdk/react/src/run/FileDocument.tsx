"use client";

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useFileInspection } from "./useFileInspection.js";
import { FileFrame } from "./FileFrame.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";

/** Props for {@link FileDocument}. */
export interface FileDocumentProps {
  /** The File: one a turn returned, or one given to the conversation. */
  readonly file: StigmerFile;
  /** Organization for the "Apply to [org]" CTA. */
  readonly org: string;
  /**
   * Whether the run that returned the File has ended. Gates the Apply action
   * (a later turn may still save over the same path).
   */
  readonly isTerminal: boolean;
  /**
   * Called after a resource is applied, or a `.zip` File is added as a
   * skill — the same host callback the preview modal fires, so a
   * document-apply behaves identically (toast / Library refresh).
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Called once the File is deleted. When provided, the header offers
   * Delete (last of its acts) to a caller holding `can_delete` on the File;
   * the host re-reads its list and closes the document.
   */
  readonly onDeleted?: () => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The editor-pane rendering of a single File — the
 * {@link SurfaceVirtualDocument} counterpart of the {@link FilePreviewModal}
 * popup, mounted as a File-family virtual document under
 * {@link FILE_DOCUMENT_ENTRY_ID}. Opening a File from the session
 * panel's Files facet lands here (VS Code "each file is a tab") rather than
 * a modal.
 *
 * Drawn through the same frame as the modal, over the same
 * {@link useFileInspection} pipeline, so the two surfaces can never drift:
 * a header with the file glyph in a muted square, the name with "{kind} ·
 * {size}" under it and the detection tag, and at its right the acts (Apply
 * as the one primary when the File is a manifest; Copy, Download, Add as
 * skill; Delete last), over the shared {@link FileBody}. Only scrolling
 * differs: the header sticks to the top of the pane while the body
 * scrolls, and the tab has no Close (its tab strip closes it).
 *
 * Holds no must-survive local state: the panel region unmounts on collapse and
 * switching tabs remounts the active document, resetting transient apply/copy
 * state exactly as the modal resets on close. The content read is cached by
 * the File's id, so reopening a recently-viewed File is instant.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function FileDocument({
  file,
  org,
  isTerminal,
  onApplied,
  onDeleted,
  className,
}: FileDocumentProps) {
  const inspection = useFileInspection(file, org, { onApplied });
  return (
    <FileFrame
      file={file}
      inspection={inspection}
      isTerminal={isTerminal}
      layout="pane"
      onApplied={onApplied}
      onDeleted={onDeleted}
      role="article"
      aria-label={`File ${file.spec?.filename ?? ""}`}
      className={className}
    />
  );
}
