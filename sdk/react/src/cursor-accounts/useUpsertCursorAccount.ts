"use client";

import { useCallback, useState } from "react";
import type { CursorAccount } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpsertCursorAccount}. */
export interface UseUpsertCursorAccountReturn {
  /**
   * Create (empty `accountId`) or update a Cursor account. The admin key
   * is plaintext to set/rotate or the `***REDACTED***` marker to keep the
   * stored value; the server validates new keys live against Cursor's
   * `/teams/members` before persisting. Returns the redacted account.
   */
  readonly upsert: (account: CursorAccount) => Promise<CursorAccount>;
  /** `true` while a save is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for creating or updating a managed Cursor account.
 *
 * The parent should refetch its list/detail view after a successful
 * save — org assignments affect key selection within the proxy's cache
 * TTL (~5 minutes).
 */
export function useUpsertCursorAccount(): UseUpsertCursorAccountReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upsert = useCallback(
    async (account: CursorAccount): Promise<CursorAccount> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.cursorAccounts.upsertAccount({ account });
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

  return { upsert, isSubmitting, error, clearError };
}
