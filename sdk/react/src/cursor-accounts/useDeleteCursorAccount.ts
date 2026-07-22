"use client";

import { useCallback, useState } from "react";
import type { CursorAccount } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Input for {@link useDeleteCursorAccount}. */
export interface DeleteCursorAccountInput {
  readonly accountId: string;
  /**
   * Deletion is refused (FAILED_PRECONDITION) while live sessions are
   * pinned to the account's keys. `force: true` overrides — their Cursor
   * agent handles will be orphaned at disposal. Prefer disabling the
   * account, which is always safe.
   */
  readonly force?: boolean;
}

/** Return value of {@link useDeleteCursorAccount}. */
export interface UseDeleteCursorAccountReturn {
  /** Delete the account (plus its snapshots and session pins). */
  readonly remove: (input: DeleteCursorAccountInput) => Promise<CursorAccount>;
  /** `true` while a delete is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for deleting a managed Cursor account. The live-pin
 * guard's FAILED_PRECONDITION message carries the pinned session count —
 * surface it verbatim so the operator can choose disable-instead.
 */
export function useDeleteCursorAccount(): UseDeleteCursorAccountReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const remove = useCallback(
    async (input: DeleteCursorAccountInput): Promise<CursorAccount> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.cursorAccounts.deleteAccount(input);
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.cursorAccounts],
  );

  const clearError = useCallback(() => setError(null), []);

  return { remove, isSubmitting, error, clearError };
}
