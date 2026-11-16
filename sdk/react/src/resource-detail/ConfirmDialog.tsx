"use client";

import { useCallback } from "react";
import { Button } from "../button/Button.js";
import { DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
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
 * Renders on {@link DialogShell} (native `<dialog>` + `showModal()` — focus
 * trapping, Escape, token backdrop). Styled via `--stgm-*` design tokens.
 *
 * Pairs with {@link useConfirmAction} which manages the imperative
 * `confirm()` → Promise pattern.
 *
 * @example
 * ```tsx
 * function DeleteWithConfirm({ onDelete }: { onDelete: () => Promise<void> }) {
 *   const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
 *   const remove = async () => {
 *     const ok = await confirm({ title: "Delete agent?", description: "This cannot be undone.", confirmLabel: "Delete", variant: "destructive" });
 *     if (ok) await onDelete();
 *   };
 *   return (
 *     <>
 *       <button onClick={remove}>Delete</button>
 *       <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
 *     </>
 *   );
 * }
 * ```
 */
export function ConfirmDialog({
  state,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onCancel();
    },
    [onCancel],
  );

  if (!state) return null;

  const isDestructive = state.variant === "destructive";

  return (
    <DialogShell open onOpenChange={handleOpenChange} width="sm">
      <DialogHeader title={state.title} description={state.description} onClose={onCancel} />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {state.cancelLabel ?? "Cancel"}
        </Button>
        <Button variant={isDestructive ? "destructive" : "primary"} onClick={onConfirm}>
          {state.confirmLabel ?? "Confirm"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
