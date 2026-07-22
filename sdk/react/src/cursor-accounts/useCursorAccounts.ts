"use client";

import type { CursorAccountsResponse } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useCursorAccounts}. */
export interface UseCursorAccountsReturn {
  /** The account summaries, or `null` before the first successful fetch. */
  readonly accounts: CursorAccountsResponse | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists every managed Cursor account with its routing and
 * sync summary (enabled member key count, last-synced timestamp). Key
 * material is always redacted server-side.
 *
 * Platform-operator surface: the caller needs
 * `can_manage_cursor_accounts` on `platform:stigmer`.
 *
 * Pass `enabled: false` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { accounts, isLoading, refetch } = useCursorAccounts();
 * ```
 */
export function useCursorAccounts(
  options?: { readonly enabled?: boolean },
): UseCursorAccountsReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;

  const { data: accounts, isLoading, isRefetching, error, refetch } = useFetch(
    enabled ? () => stigmer.cursorAccounts.listAccounts() : null,
    [enabled, stigmer],
    null as CursorAccountsResponse | null,
  );

  return { accounts, isLoading, isRefetching, error, refetch };
}
