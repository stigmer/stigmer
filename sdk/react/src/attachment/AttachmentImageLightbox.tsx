"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";

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
      dismissOnBackdrop
      aria-label={`Preview ${filename}`}
      // Lightbox outlier: viewport-relative sizing (not a width preset) and
      // the background surface for image content.
      className={cn(
        "stg:w-auto stg:max-h-[85vh] stg:max-w-[85vw] stg:bg-background stg:text-foreground stg:outline-none",
        className,
      )}
    >
      {open && (
        <div className="stg:flex stg:flex-col">
          <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-2">
            {/* No tooltip here: the house tooltip portals OUTSIDE this native
                showModal() dialog, where the top layer covers it and `inert`
                disables it. The old title only restated the visible filename
                (also the image's alt), so it is dropped rather than replaced. */}
            <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-xs stg:font-semibold stg:text-foreground">
              {filename}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close image preview"
              className="stg:shrink-0 stg:cursor-pointer stg:rounded stg:p-0.5 stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="stg:min-h-0 stg:overflow-auto stg:border-t stg:border-border">
            {src ? (
              <img
                src={src}
                alt={filename}
                className="stg:block stg:max-h-[75vh] stg:max-w-full stg:object-contain"
              />
            ) : (
              <div
                className="stg:h-48 stg:w-72 stg:animate-pulse stg:bg-muted"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      )}
    </DialogShell>
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
