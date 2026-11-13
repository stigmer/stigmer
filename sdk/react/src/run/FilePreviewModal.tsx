"use client";

import { useCallback, type ReactNode } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { DialogShell } from "../internal/DialogShell.js";
import { FileFrame } from "./FileFrame.js";
import { useFileInspection } from "./useFileInspection.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";

// ---------------------------------------------------------------------------
// FilePreviewContent — standalone content component
// ---------------------------------------------------------------------------

/** Props for {@link FilePreviewContent}. */
export interface FilePreviewContentProps {
  /** The File to preview. */
  readonly file: StigmerFile;
  /** Organization id for the "Apply to [org]" CTA (a slug is also accepted). */
  readonly org: string;
  /**
   * Whether the run that returned the File has ended. Controls Apply CTA
   * availability:
   *
   * - `true` — CTA renders as an enabled primary button
   * - `false` — CTA renders disabled (a later turn may still save over it)
   */
  readonly isTerminal: boolean;
  /** Called when the close button is clicked. */
  readonly onClose: () => void;
  /**
   * Called after a resource is successfully applied. The consumer can use
   * this for post-apply behavior such as showing a toast or navigating to
   * the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * The reader may only read, copy and download the File: no Apply, no
   * adding it as a skill and no delete, and no permission read for them.
   * For a reader whose credential the server refuses those acts, such as a
   * chat link's guest.
   */
  readonly readOnly?: boolean;
  /**
   * Optional plan-build action. When provided, "Build" is the header's
   * primary act (used for a plan: turn the plan into a Run), in place of
   * Apply. Clicking it calls `onImplement` then closes the modal. Omit for
   * non-actionable Files.
   */
  readonly onImplement?: () => void;
  /**
   * Called once the File is deleted. When provided, the header offers
   * Delete (last of its acts) to a caller holding `can_delete` on the File;
   * the host re-reads its list (the content stays mounted until the host
   * closes it).
   */
  readonly onDeleted?: () => void;
  /**
   * Host-owned controls for who may see the File (the Library's visibility
   * and Manage access), rendered among the header's acts, before Delete.
   */
  readonly accessSlot?: ReactNode;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * One File's preview content with detection pipeline and Apply CTA.
 *
 * Drawn through the same frame as the session panel's {@link FileDocument},
 * so the two read as one object: a header with the file glyph in a muted
 * square, the name with "{kind} · {size}" under it and the detection tag,
 * and at its right the acts (at most one primary, Build or Apply; then
 * Copy, Download, Add as skill, the host's access controls, Delete last)
 * and Close; under it the body. The parent is responsible for rendering it
 * inside a `<dialog>`, modal, sheet, overlay, or inline context as needed.
 *
 * Orchestrates the shared detection pipeline (see {@link useFileInspection}):
 *
 * it reads a text File via `useFileContent`, renders it via
 * {@link TextContentRenderer} (markdown, YAML, JSON, or plain text based
 * on file type), and detects Agent resources via
 * {@link useDetectStigmerResource}.
 *
 * Content fetching begins immediately on mount. Unmounting the component
 * resets all internal state (detection, apply result, clipboard). For
 * gated rendering (e.g. only when a dialog is open), conditionally
 * mount this component rather than passing an `active` flag.
 *
 * @example
 * ```tsx
 * import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
 *
 * // Inside a dialog, a panel or an overlay of your own.
 * function FilePanel({ file, org, onClose }: { file: File; org: string; onClose: () => void }) {
 *   const applied = (result: { kind: string }) => toast(`${result.kind} applied`);
 *   return <FilePreviewContent file={file} org={org} isTerminal onClose={onClose} onApplied={applied} />;
 * }
 * ```
 *
 * @see {@link FilePreviewModal} — wraps this component in a native `<dialog>`
 * @see {@link FileRow} — dense list row that triggers preview via `onOpen`
 * @see {@link useDetectStigmerResource} — YAML resource detection (headless)
 * @see {@link useApplyResource} — apply behavior hook (headless)
 */
export function FilePreviewContent({
  file,
  org,
  isTerminal,
  onClose,
  onApplied,
  onImplement,
  onDeleted,
  readOnly = false,
  accessSlot,
  className,
}: FilePreviewContentProps) {
  // The whole inspect-and-act pipeline (content, detection, apply, copy)
  // lives in one headless hook, shared with the editor-area FileDocument so
  // the two surfaces can never drift.
  const inspection = useFileInspection(file, org, { onApplied });

  // "Build" runs the plan; closing the modal lets the host's submit pipeline
  // take over (switch to Agent + send). Single combined handler keeps the
  // caller's contract simple ("just give me onImplement").
  const handleImplement = useCallback(() => {
    onImplement?.();
    onClose();
  }, [onImplement, onClose]);

  return (
    <FileFrame
      file={file}
      inspection={inspection}
      isTerminal={isTerminal}
      layout="window"
      readOnly={readOnly}
      onBuild={onImplement ? handleImplement : undefined}
      onApplied={onApplied}
      onDeleted={onDeleted}
      accessSlot={accessSlot}
      onClose={onClose}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// FilePreviewModal — thin <dialog> shell
// ---------------------------------------------------------------------------

/** Props for {@link FilePreviewModal}. */
export interface FilePreviewModalProps {
  /** The File to preview. */
  readonly file: StigmerFile;
  /** Organization id for the "Apply to [org]" CTA (a slug is also accepted). */
  readonly org: string;
  /**
   * Whether the run that returned the File has ended. Controls Apply CTA
   * availability:
   *
   * - `true` — CTA renders as an enabled primary button
   * - `false` — CTA renders disabled (a later turn may still save over it)
   */
  readonly isTerminal: boolean;
  /** Controls modal visibility. `true` opens the dialog via `showModal()`. */
  readonly open: boolean;
  /** Called when the modal should close (Escape key or close button). */
  readonly onClose: () => void;
  /**
   * Called after a resource is successfully applied. The consumer can use
   * this for post-apply behavior such as showing a toast or navigating to
   * the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * The reader may only read, copy and download the File: no Apply, no
   * adding it as a skill and no delete, and no permission read for them.
   * For a reader whose credential the server refuses those acts, such as a
   * chat link's guest.
   */
  readonly readOnly?: boolean;
  /**
   * Optional plan-build action (see {@link FilePreviewContentProps.onImplement}).
   * When provided, "Build" is the header's primary act; clicking it calls
   * `onImplement` then closes the modal.
   */
  readonly onImplement?: () => void;
  /** See {@link FilePreviewContentProps.onDeleted}. */
  readonly onDeleted?: () => void;
  /** See {@link FilePreviewContentProps.accessSlot}. */
  readonly accessSlot?: ReactNode;
  /** Additional CSS classes for the dialog element. */
  readonly className?: string;
}

/**
 * Full preview modal for one File using a native `<dialog>`.
 *
 * Thin shell around {@link FilePreviewContent} that adds
 * `showModal()` / `close()` lifecycle, `::backdrop` overlay, focus
 * trap, and Escape key handling — with no dependency on
 * `@base-ui/react`.
 *
 * The content component is conditionally mounted when `open` is true,
 * so all internal state (detection, apply result, clipboard) resets
 * automatically when the dialog closes.
 *
 * @example
 * ```tsx
 * import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
 *
 * function FileLink({ file, org }: { file: File; org: string }) {
 *   const [open, setOpen] = useState(false);
 *   return (
 *     <>
 *       <button onClick={() => setOpen(true)}>{file.metadata?.name}</button>
 *       <FilePreviewModal file={file} org={org} isTerminal open={open} onClose={() => setOpen(false)} />
 *     </>
 *   );
 * }
 * ```
 *
 * @see {@link FilePreviewContent} — the content component (use directly for non-dialog contexts)
 * @see {@link FileRow} — dense list row that triggers preview via `onOpen`
 */
export function FilePreviewModal({
  file,
  org,
  isTerminal,
  open,
  onClose,
  onApplied,
  onImplement,
  onDeleted,
  readOnly = false,
  accessSlot,
  className,
}: FilePreviewModalProps) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose();
    },
    [onClose],
  );

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      width="3xl"
      aria-label={`Preview ${file.spec?.filename ?? ""}`}
      // Background surface is deliberate for content previews. The
      // previously hardcoded ::backdrop color (bg-black/50 — it escaped the
      // #652 fence via the arbitrary-variant spelling) now rides the
      // shell's token backdrop.
      className={cn("stg:bg-background stg:text-foreground stg:outline-none", className)}
    >
      {open && (
        <FilePreviewContent
          file={file}
          org={org}
          isTerminal={isTerminal}
          onClose={onClose}
          onApplied={onApplied}
          onImplement={onImplement}
          onDeleted={onDeleted}
          readOnly={readOnly}
          accessSlot={accessSlot}
        />
      )}
    </DialogShell>
  );
}
