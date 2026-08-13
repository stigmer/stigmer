"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, ReactNode, SyntheticEvent } from "react";
import { cn } from "@stigmer/theme";

/**
 * Width presets for {@link DialogShell}, mapping to Tailwind `max-w-*`
 * utilities. Free-form sizes (e.g. a lightbox's `85vw`) ride `className`,
 * which wins over the preset via `cn()`'s tailwind-merge.
 */
export type DialogShellWidth = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";

const WIDTH_CLASS: Record<DialogShellWidth, string> = {
  sm: "stg:max-w-sm",
  md: "stg:max-w-md",
  lg: "stg:max-w-lg",
  xl: "stg:max-w-xl",
  "2xl": "stg:max-w-2xl",
  "3xl": "stg:max-w-3xl",
  "4xl": "stg:max-w-4xl",
};

/** Props for {@link DialogShell}. */
export interface DialogShellProps {
  /** Whether the dialog is open (controlled — the SDK dialog convention). */
  readonly open: boolean;
  /**
   * Called with `false` when the dialog should close: Escape / the platform
   * cancel gesture, or a native close the host did not drive (e.g. a
   * `method="dialog"` form submit). The shell never closes itself — state
   * stays authoritative, so a host that ignores the callback keeps the
   * dialog open (matching the pre-extraction per-dialog behavior).
   */
  readonly onOpenChange: (open: boolean) => void;
  /** Max-width preset (default `"md"`). See {@link DialogShellWidth}. */
  readonly width?: DialogShellWidth;
  /**
   * Modal (default) renders in the top layer via `showModal()` — focus trap,
   * Escape, and the token backdrop. `modal={false}` renders the dialog
   * in-flow (`open` attribute, relative positioning, no backdrop, no focus
   * trap) — the channel-dialog embedding mode.
   */
  readonly modal?: boolean;
  /**
   * Light dismiss: a click on the backdrop (the dialog element itself —
   * clicks inside the content land on descendants) reports close intent.
   * The house rule from the pre-extraction census: read-only viewers
   * (diff/YAML/explain/lightbox/pickers) dismiss on backdrop, form dialogs
   * do NOT — a stray click must never discard a half-filled form. Default
   * `false`.
   */
  readonly dismissOnBackdrop?: boolean;
  /**
   * Merged after the shell's own chrome, so deliberate outliers (a
   * lightbox's viewport sizing, a fullscreen graph's `h-[90vh]`, a
   * `bg-background` surface) override the defaults per class.
   */
  readonly className?: string;
  /** Dialog content. Lazy-mounting bodies (`{open && …}`) stay caller-owned. */
  readonly children: ReactNode;
  /** Accessible name, when no visible heading labels the dialog. */
  readonly "aria-label"?: string;
  /** Id of the visible heading that labels the dialog. */
  readonly "aria-labelledby"?: string;
}

/**
 * The one dialog shell (stigmer#653). Owns everything every modal dialog in
 * the SDK used to re-transcribe by hand: the `<dialog>` element and its
 * `showModal()`/`close()` lifecycle, cancel/Escape wiring, the token
 * backdrop (`--stgm-backdrop`), the open animation, and the base
 * positioning/chrome — parameterized by {@link DialogShellWidth}.
 *
 * Converged chrome: `rounded-xl` + `shadow-xl` on the `popover` token
 * surface (the token family for top-layer content). Before the extraction
 * the 24 hand-rolled shells had drifted across `rounded-lg/xl`,
 * `shadow-lg/xl/2xl`, three background tokens, two hardcoded backdrops that
 * escaped the #652 fence, and animation classes present on some dialogs and
 * missing from others.
 *
 * Internal on purpose — not exported from the package until a host needs it.
 * The `stigmer/no-handrolled-dialog` lint rule fences new `<dialog>`
 * elements onto this shell.
 *
 * @example
 * ```tsx
 * <DialogShell open={open} onOpenChange={setOpen} width="lg" aria-labelledby={titleId}>
 *   {open && <MyDialogBody titleId={titleId} onClose={() => setOpen(false)} />}
 * </DialogShell>
 * ```
 */
export function DialogShell({
  open,
  onOpenChange,
  width = "md",
  modal = true,
  dismissOnBackdrop = false,
  className,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync the native top-layer state to the controlled prop. Runs on mount
  // too, so a shell mounted with `open` already true shows immediately.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !modal) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, modal]);

  // Escape / platform cancel: keep the native dialog open (preventDefault)
  // and report the intent — the controlled `open` prop then drives the
  // actual close through the effect above.
  const handleCancel = useCallback(
    (e: SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  // A native close the effect did not perform (e.g. a `method="dialog"`
  // form submit) must not leave the controlled state stranded open.
  const handleClose = useCallback(() => {
    if (open) onOpenChange(false);
  }, [open, onOpenChange]);

  // Backdrop clicks hit the <dialog> element itself; clicks anywhere in the
  // content land on a descendant, so the target check is exact.
  const handleClick = useCallback(
    (e: MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) onOpenChange(false);
    },
    [onOpenChange],
  );

  return (
    <dialog
      ref={dialogRef}
      open={modal ? undefined : open || undefined}
      onCancel={modal ? handleCancel : undefined}
      onClose={modal ? handleClose : undefined}
      onClick={modal && dismissOnBackdrop ? handleClick : undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn(
        "stg:w-full stg:rounded-xl stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-xl",
        modal
          ? cn(
              "stg:fixed stg:inset-0 stg:z-50 stg:m-auto",
              "stg:backdrop:bg-backdrop",
              "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
            )
          : "stg:relative",
        WIDTH_CLASS[width],
        className,
      )}
    >
      {children}
    </dialog>
  );
}
