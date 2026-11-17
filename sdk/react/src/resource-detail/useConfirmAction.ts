"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ConfirmOptions, ConfirmState } from "./types.js";

export interface UseConfirmActionReturn {
  /**
   * The pending confirmation state, or `null` when no confirmation
   * is active. Pass this to a `ConfirmDialog` component to render
   * the dialog UI.
   */
  readonly confirmState: ConfirmState | null;

  /**
   * Trigger a confirmation prompt. Returns a promise that resolves
   * to `true` when confirmed, `false` when cancelled. With an `action`
   * in the options, it resolves `true` only once the action succeeds:
   * a failed action keeps the dialog open to try again or cancel.
   *
   * @example
   * ```tsx
   * const removed = await confirm({
   *   title: "Remove Grace Hopper?",
   *   description: "Grace loses the Admin role.",
   *   confirmLabel: "Remove",
   *   variant: "destructive",
   *   action: () => revokeRole(grace),
   *   failureTitle: "Couldn't remove Grace Hopper.",
   * });
   * if (removed) refresh();
   * ```
   */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;

  /** Accept the pending confirmation (runs its `action`, when it has one). */
  readonly handleConfirm: () => void;
  /** Dismiss the pending confirmation. Held while its `action` runs. */
  readonly handleCancel: () => void;
}

/** A thrown value as an Error, so the dialog's failure can read it. */
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(typeof thrown === "string" ? thrown : "The request failed.");
}

/**
 * State management hook for confirmation dialogs.
 *
 * Provides an imperative `confirm()` function that returns a promise,
 * paired with `confirmState` for rendering a `ConfirmDialog`. A
 * confirmation that carries its `action` runs it here: busy while it
 * runs, its failure kept on the state for the dialog to say, closed and
 * resolved `true` only on success.
 *
 * Separates the state logic (this hook) from the visual presentation
 * (ConfirmDialog component) following the headless-first architecture.
 */
export function useConfirmAction(): UseConfirmActionReturn {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  // The current state, read by the handlers after an await, when the
  // render's copy may be stale (a second confirm, a cancel).
  const current = useRef<ConfirmState | null>(null);
  const update = useCallback((next: ConfirmState | null) => {
    current.current = next;
    setConfirmState(next);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        update({ ...options, resolve });
      });
    },
    [update],
  );

  const handleConfirm = useCallback(() => {
    const pending = current.current;
    if (!pending || pending.busy) return;
    const action = pending.action;
    if (!action) {
      pending.resolve(true);
      update(null);
      return;
    }
    update({ ...pending, busy: true, error: null });
    // Still this confirmation: no other was opened while the act ran.
    const stillPending = () => current.current?.resolve === pending.resolve;
    action().then(
      () => {
        if (!stillPending()) return;
        pending.resolve(true);
        update(null);
      },
      (thrown: unknown) => {
        if (!stillPending()) return;
        update({ ...pending, busy: false, error: asError(thrown) });
      },
    );
  }, [update]);

  const handleCancel = useCallback(() => {
    const pending = current.current;
    if (!pending || pending.busy) return;
    pending.resolve(false);
    update(null);
  }, [update]);

  return useMemo(
    () => ({ confirmState, confirm, handleConfirm, handleCancel }),
    [confirmState, confirm, handleConfirm, handleCancel],
  );
}
