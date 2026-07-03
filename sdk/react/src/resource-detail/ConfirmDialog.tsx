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
        "fixed inset-0 z-50 m-auto w-full max-w-sm rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-semibold text-foreground">
            {state.title}
          </h3>
          <p className="text-sm text-muted-foreground">
            {state.description}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "border border-input bg-background text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDestructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive-hover"
                : "bg-primary text-primary-foreground hover:bg-primary-hover",
            )}
          >
            {state.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
