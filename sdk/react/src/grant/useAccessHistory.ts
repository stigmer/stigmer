"use client";

import { create } from "@bufbuild/protobuf";
import {
  type AccessHistoryEntry,
  type AccessHistoryPage,
  ListAccessHistoryInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Options for {@link useAccessHistory}. */
export interface UseAccessHistoryOptions {
  /** Entries per page, the first and each `loadMore`; the server caps it at 100. @default 50 */
  readonly pageSize?: number;
}

/** How long the server keeps the history, as its first page says. */
export interface AccessHistoryRetention {
  /** Days the server keeps the history; 0 when it keeps it for good. */
  readonly days: number;
  /** The lowest number the organization still holds; 0 when it holds none. */
  readonly oldestSequence: bigint;
}

/** Return value of {@link useAccessHistory}. */
export interface UseAccessHistoryReturn {
  /** The organization's access history, newest first: the first page, then every page loaded since. */
  readonly entries: readonly AccessHistoryEntry[];
  /** How long the server keeps the history, from the first page; `null` until it loads. */
  readonly retention: AccessHistoryRetention | null;
  /** `true` while older entries exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next, older page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` only during the first load. */
  readonly isLoading: boolean;
  /** Error from the last failed first-page read, or `null`. */
  readonly error: Error | null;
  /** Re-read the first page; entries made since appear at the head. */
  readonly refetch: () => void;
}

/**
 * Data hook that pages an organization's access history through
 * `GrantQueryController.listAccessHistory`, newest first: every time
 * someone was given or lost access, who did it, why and when.
 *
 * The server answers only the organization's owners and administrators,
 * a parent organization's administrators included, since they are
 * administrators in every child (`can_view_access_history`), and each of
 * them reads all of it; gate the hook on that permission and pass
 * `null` otherwise, which keeps it idle. An open-source server keeps no
 * history and answers UNIMPLEMENTED.
 *
 * A server may keep the history for a limited time, set by its operator;
 * `retention` says how long, and the oldest number the organization still
 * holds, from the first page.
 *
 * To hand the whole history to another tool, use `exportAccessHistory`
 * and `accessHistoryJsonLine` from `@stigmer/sdk`.
 *
 * @example
 * ```tsx
 * const { entries, hasMore, loadMore } = useAccessHistory(orgId);
 * ```
 */
export function useAccessHistory(
  org: string | null,
  options: UseAccessHistoryOptions = {},
): UseAccessHistoryReturn {
  const stigmer = useStigmer();
  const pageSize = options.pageSize ?? 50;
  const pages = useCursorPages<AccessHistoryEntry, AccessHistoryPage>(
    org
      ? (pageToken) =>
          stigmer.grant.listAccessHistory(
            create(ListAccessHistoryInputSchema, { org, pageSize, pageToken }),
          )
      : null,
    [org, pageSize, stigmer],
    (entry) => entry.sequence.toString(),
  );
  const firstPage = pages.firstPage;
  return {
    entries: pages.items,
    retention:
      firstPage === null
        ? null
        : { days: firstPage.retentionDays, oldestSequence: firstPage.oldestSequence },
    hasMore: pages.hasMore,
    loadMore: pages.loadMore,
    isLoadingMore: pages.isLoadingMore,
    loadMoreError: pages.loadMoreError,
    isLoading: pages.isLoading,
    error: pages.error,
    refetch: pages.refetch,
  };
}
