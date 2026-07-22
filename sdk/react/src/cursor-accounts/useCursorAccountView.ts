"use client";

import type { CursorAccountView } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useCursorAccountView}. */
export interface UseCursorAccountViewReturn {
  /** The detail view, or `null` before the first successful fetch. */
  readonly view: CursorAccountView | null;
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
 * Data hook for one Cursor account's detail view: the redacted account,
 * the latest roster/spend snapshot, and the server-computed coverage
 * join (per-key owner state and cycle spend, active members without
 * keys).
 *
 * Pass `null` as `accountId` to skip fetching (e.g. while the console is
 * on the list phase).
 *
 * @example
 * ```tsx
 * const { view, isLoading, refetch } = useCursorAccountView(accountId);
 * ```
 */
export function useCursorAccountView(
  accountId: string | null,
): UseCursorAccountViewReturn {
  const stigmer = useStigmer();

  const { data: view, isLoading, isRefetching, error, refetch } = useFetch(
    accountId
      ? () => stigmer.cursorAccounts.getAccountView(accountId)
      : null,
    [accountId, stigmer],
    null as CursorAccountView | null,
  );

  return { view, isLoading, isRefetching, error, refetch };
}
