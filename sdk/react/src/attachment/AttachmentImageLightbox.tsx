"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link AttachmentImageLightbox}. */
export interface AttachmentImageLightboxProps {
  /**
   * Image source URL. `null` for the first-paint frame before the caller's
   * object URL exists — the lightbox shows a pulse placeholder, never a
   * broken-image glyph.
   */
  readonly src: string | null;
  /** Filename shown in the header and used as the image alt text. */
  readonly filename: string;
  /** Controls visibility. `true` opens the dialog via `showModal()`. */
  readonly open: boolean;
  /** Called when the lightbox should close (Escape, backdrop click, close button). */
  readonly onClose: () => void;
  /** Additional CSS classes for the dialog element. */
  readonly className?: string;
}

/**
 * Full-size image preview in a native `<dialog>` — the click-to-open target
 * for composer attachment chips (stigmer/stigmer#371).
 *
 * A thin modal shell following the SDK's established dialog pattern
 * ({@link ArtifactPreviewModal}): `showModal()`/`close()` driven by the
 * `open` prop, Escape via the intercepted `cancel` event, focus trap and
 * top layer native — no portal plumbing, no `@base-ui/react` dependency.
 * Backdrop click closes via the canonical `e.target === dialog` check
 * (clicks on content children never match the dialog element itself).
 *
 * Deliberately dumb (`src` + `filename`, no attachment types): liftable to
 * `internal/` unchanged if other image surfaces (e.g. tool-output
 * screenshots in `ResultView`) later want in-app preview instead of
 * open-in-new-tab.
 *
 * The backdrop uses the `--stgm-backdrop` theme token ("modal backdrop
 * overlay behind dialogs") rather than the `bg-black/50` hardcode found in
 * older dialogs — the token is the designed value (Dont-Do #3).
 */
export function AttachmentImageLightbox({
  src,
  filename,
  open,
  onClose,
  className,
}: AttachmentImageLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape arrives as the native `cancel` event; intercept it so the
  // caller's `open` prop stays the single source of truth for visibility.
  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      aria-label={`Preview ${filename}`}
      className={cn(
        "fixed inset-0 m-auto max-h-[85vh] max-w-[85vw] rounded-lg border border-border bg-background p-0 text-foreground shadow-lg outline-none",
        "backdrop:bg-backdrop",
        className,
      )}
    >
      {open && (
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
              title={filename}
            >
              {filename}
            </span>
            {/* `bg-transparent` neutralizes the UA button box in
                preflight-less hosts (see UNSTYLED_BUTTON in the chip list). */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close image preview"
              className="shrink-0 cursor-pointer rounded bg-transparent p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 overflow-auto border-t border-border">
            {src ? (
              <img
                src={src}
                alt={filename}
                className="block max-h-[75vh] max-w-full object-contain"
              />
            ) : (
              <div
                className="h-48 w-72 animate-pulse bg-muted"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK pattern: no external icon dependency)
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3L11 11" />
      <path d="M11 3L3 11" />
    </svg>
  );
}
