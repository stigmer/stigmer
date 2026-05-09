"use client";

import { useCallback, useMemo, useState } from "react";
import type { ConfirmOptions, ConfirmState } from "./types";

export interface UseConfirmActionReturn {
  /**
   * The pending confirmation state, or `null` when no confirmation
   * is active. Pass this to a `ConfirmDialog` component to render
   * the dialog UI.
   */
  readonly confirmState: ConfirmState | null;

  /**
   * Trigger a confirmation prompt. Returns a promise that resolves
   * to `true` when confirmed, `false` when cancelled.
   *
   * @example
   * ```tsx
   * const confirmed = await confirm({
   *   title: "Delete agent?",
   *   description: "This action cannot be undone.",
   *   confirmLabel: "Delete",
   *   variant: "destructive",
   * });
   * if (confirmed) await deleteAgent();
   * ```
   */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;

  /** Accept the pending confirmation. */
  readonly handleConfirm: () => void;
  /** Dismiss the pending confirmation. */
  readonly handleCancel: () => void;
}

/**
 * State management hook for confirmation dialogs.
 *
 * Provides an imperative `confirm()` function that returns a promise,
 * paired with `confirmState` for rendering a `ConfirmDialog`.
 *
 * Separates the state logic (this hook) from the visual presentation
 * (ConfirmDialog component) following the headless-first architecture
 * (DD-003).
 */
export function useConfirmAction(): UseConfirmActionReturn {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    confirmState?.resolve(true);
    setConfirmState(null);
  }, [confirmState]);

  const handleCancel = useCallback(() => {
    confirmState?.resolve(false);
    setConfirmState(null);
  }, [confirmState]);

  return useMemo(
    () => ({ confirmState, confirm, handleConfirm, handleCancel }),
    [confirmState, confirm, handleConfirm, handleCancel],
  );
}
