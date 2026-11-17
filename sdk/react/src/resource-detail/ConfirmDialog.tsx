"use client";

import { useCallback } from "react";
import { Button } from "../button/Button.js";
import { ErrorMessage, canTryAgain } from "../error/ErrorMessage.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
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
 * `confirm()` → Promise pattern. A confirmation given its `action` does
 * the act from the dialog: while it runs, the confirm button waits with a
 * spinner and Cancel, the close button and Escape are held; a failure is
 * said in the dialog (the kit's `ErrorMessage`) with the confirm button
 * reading "Try again"; the dialog closes once the act succeeds.
 *
 * @example
 * ```tsx
 * function DeleteWithConfirm({ onDelete, onDeleted }: { onDelete: () => Promise<void>; onDeleted: () => void }) {
 *   const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
 *   const remove = async () => {
 *     // The dialog deletes: it waits while onDelete runs and says a failure in place.
 *     const deleted = await confirm({
 *       title: "Delete agent?",
 *       description: "This cannot be undone.",
 *       confirmLabel: "Delete",
 *       variant: "destructive",
 *       action: onDelete,
 *       failureTitle: "Couldn't delete the agent.",
 *     });
 *     if (deleted) onDeleted();
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
  const busy = state?.busy === true;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Escape while the act runs is held, as Cancel is.
      if (!open && !busy) onCancel();
    },
    [onCancel, busy],
  );

  if (!state) return null;

  const isDestructive = state.variant === "destructive";
  const failure = !busy && state.error ? state.error : null;

  return (
    <DialogShell open onOpenChange={handleOpenChange} width="sm">
      <DialogHeader title={state.title} description={state.description} onClose={onCancel} closeDisabled={busy} />
      {failure && (
        <DialogBody>
          <ErrorMessage error={failure} title={state.failureTitle} />
        </DialogBody>
      )}
      <DialogFooter>
        {/* Focus starts on Cancel: Enter or Space on opening never confirms. */}
        <Button variant="ghost" onClick={onCancel} disabled={busy} data-autofocus="">
          {state.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          variant={isDestructive ? "destructive" : "primary"}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
          icon={busy ? <SpinnerIcon size={14} /> : undefined}
        >
          {/* Try again only where trying again can help; a refusal keeps the act's own word. */}
          {failure && canTryAgain(failure) ? "Try again" : (state.confirmLabel ?? "Confirm")}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
