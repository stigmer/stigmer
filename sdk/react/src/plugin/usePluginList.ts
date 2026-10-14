"use client";

import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useResourceCount, useResourceList } from "../search/index.js";

/** Options for {@link usePluginList}. */
export interface UsePluginListOptions {
  /** Maximum plugins per page, the first and each `loadMore`. @default 20 */
  readonly pageSize?: number;
  /** Text query to filter plugins by name, description, or tags. */
  readonly query?: string;
}

/** Return value of {@link usePluginList}. */
export interface UsePluginListReturn {
  /** The first page of plugins, then every page loaded since. */
  readonly plugins: readonly SearchResult[];
  /** `true` while the server holds plugins beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the first page; pages loaded since stay. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists an organization's plugins for the Library, a page at
 * a time: `stigmer.plugin.list()` newest first while `query` is empty,
 * search matches while it holds text. All parameters are externally
 * controlled — the consumer manages query debouncing. A list carries no
 * total; use {@link usePluginCount} for a count.
 *
 * For picker/type-ahead search with internal debouncing and query
 * state management, use {@link usePluginSearch} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { plugins, hasMore, loadMore, isLoading } = usePluginList("acme", { pageSize: 20 });
 * ```
 */
export function usePluginList(
  org: string | null,
  options?: UsePluginListOptions,
): UsePluginListReturn {
  const { entries, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } =
    useResourceList(ApiResourceKind.plugin, org, options);

  return { plugins: entries, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch };
}

/** Options for {@link usePluginCount}. */
export interface UsePluginCountOptions {
  /** Text query to filter plugins before counting. */
  readonly query?: string;
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link usePluginCount}. */
export interface UsePluginCountReturn {
  /** Total number of plugins matching the filters; `undefined` until the first fetch completes. */
  readonly count: number | undefined;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of installed plugins, for summary
 * cards and badges, read from search's count for the kind (no entries are
 * kept). Pass `null` as `org` to skip fetching.
 */
export function usePluginCount(org: string | null, options?: UsePluginCountOptions): UsePluginCountReturn {
  return useResourceCount(ApiResourceKind.plugin, org, options);
}
