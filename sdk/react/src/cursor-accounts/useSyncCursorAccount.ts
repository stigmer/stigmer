"use client";

import { useCallback, useState } from "react";
import type { CursorAccountView } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useSyncCursorAccount}. */
export interface UseSyncCursorAccountReturn {
  /**
   * Run an on-demand roster + spend sync and return the refreshed view.
   * The Cursor Admin API is rate-limited (20 req/min, poll-hourly
   * guidance) — `isSyncing` should disable the trigger while in flight,
   * and callers should not poll this.
   */
  readonly sync: (accountId: string) => Promise<CursorAccountView>;
  /** `true` while a sync is in flight. */
  readonly isSyncing: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for the console's "Sync now" — the same server-side sync
 * the hourly schedule runs, on demand.
 */
export function useSyncCursorAccount(): UseSyncCursorAccountReturn {
  const stigmer = useStigmer();
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sync = useCallback(
    async (accountId: string): Promise<CursorAccountView> => {
      setIsSyncing(true);
      setError(null);
      try {
        return await stigmer.cursorAccounts.syncAccount(accountId);
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSyncing(false);
      }
    },
    [stigmer.cursorAccounts],
  );

  const clearError = useCallback(() => setError(null), []);

  return { sync, isSyncing, error, clearError };
}
