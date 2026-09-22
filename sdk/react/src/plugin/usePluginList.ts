"use client";

import { useCallback } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useResourceCount, useResourceList } from "../search/index.js";

/** Options for {@link usePluginList}. */
export interface UsePluginListOptions {
  /** Maximum plugins per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter plugins by name, description or keywords. */
  readonly query?: string;
}

/** Return value of {@link usePluginList}. */
export interface UsePluginListReturn {
  /** Paginated plugin entries for the current page. */
  readonly plugins: readonly SearchResult[];
  /** Total number of plugins matching the current filters. */
  readonly totalCount: number;
  /** Total pages available at the current page size. */
  readonly totalPages: number;
  /** The current page number (mirrors the `page` option). */
  readonly currentPage: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a paginated list of installed plugins for the
 * Library. Wraps `stigmer.plugin.list()` (the search-backed listing every
 * indexed kind shares) with pagination and text search over the
 * organization's plugins; the consumer owns page state and query debouncing.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { plugins, totalCount } = usePluginList("acme", { page: 1, pageSize: 20 });
 * ```
 */
export function usePluginList(org: string | null, options?: UsePluginListOptions): UsePluginListReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.plugin.list>[0]) => stigmer.plugin.list(params),
    [stigmer],
  );

  const { entries, totalCount, totalPages, currentPage, isLoading, error, refetch } = useResourceList(
    listFn,
    org,
    options,
  );

  return { plugins: entries, totalCount, totalPages, currentPage, isLoading, error, refetch };
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
 * cards and badges. Issues a minimal `stigmer.plugin.list()` call for the
 * count alone. Pass `null` as `org` to skip fetching.
 */
export function usePluginCount(org: string | null, options?: UsePluginCountOptions): UsePluginCountReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.plugin.list>[0]) => stigmer.plugin.list(params),
    [stigmer],
  );

  return useResourceCount(listFn, org, options);
}
