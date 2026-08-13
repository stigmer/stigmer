"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { ConfirmState } from "./types.js";

export interface ConfirmDialogProps {
  /** Pending confirmation state from {@link useConfirmAction}. */
  readonly state: ConfirmState | null;
  /** Accept the pending confirmation. */
  readonly onConfirm: () => void;
  /** Dismiss the pending confirmation. */
  readonly onCancel: () => void;
}

/**
 * Accessible confirmation dialog for destructive actions.
 *
 * Uses the native `<dialog>` element with `showModal()` for built-in
 * focus trapping, Escape key handling, and backdrop. Styled via
 * `--stgm-*` design tokens.
 *
 * Pairs with {@link useConfirmAction} which manages the imperative
 * `confirm()` → Promise pattern.
 *
 * @example
 * ```tsx
 * const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
 *
 * // Trigger
 * const handleDelete = async () => {
 *   const ok = await confirm({
 *     title: "Delete agent?",
 *     description: "This cannot be undone.",
 *     confirmLabel: "Delete",
 *     variant: "destructive",
 *   });
 *   if (ok) await deleteAgent();
 * };
 *
 * // Render
 * <ConfirmDialog
 *   state={confirmState}
 *   onConfirm={handleConfirm}
 *   onCancel={handleCancel}
 * />
 * ```
 */
export function ConfirmDialog({
  state,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state && !dialog.open) {
      dialog.showModal();
    } else if (!state && dialog.open) {
      dialog.close();
    }
  }, [state]);

  const handleDialogCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onCancel();
    },
    [onCancel],
  );

  if (!state) return null;

  const isDestructive = state.variant === "destructive";

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      className={cn(
        "stg:fixed stg:inset-0 stg:z-50 stg:m-auto stg:w-full stg:max-w-sm stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-lg",
        "stg:backdrop:bg-backdrop",
        "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
      )}
    >
      <div className="stg:flex stg:flex-col stg:gap-4 stg:p-6">
        <div className="stg:flex stg:flex-col stg:gap-1.5">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
            {state.title}
          </h3>
          <p className="stg:text-sm stg:text-muted-foreground">
            {state.description}
          </p>
        </div>
        <div className="stg:flex stg:justify-end stg:gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:border stg:border-input stg:bg-background stg:text-foreground",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              isDestructive
                ? "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover"
                : "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            )}
          >
            {state.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
