"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListParams, ListResult } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

/**
 * Scope controls resource listing boundaries.
 *
 * - `"org"` — resources owned by the active organization (public and private).
 * - `"all"` — resources owned by the active organization plus public resources
 *   from other organizations.
 */
export type ResourceListScope = "org" | "all";

export interface UseResourceListOptions {
  /** Maximum results per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter results. No debouncing is applied — the consumer controls timing. */
  readonly query?: string;
  /**
   * Controls resource visibility scope.
   *
   * - `"org"` — all resources owned by the given organization, regardless of visibility.
   * - `"all"` — all resources owned by the given organization plus public resources
   *   from other organizations.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

export interface UseResourceListReturn {
  readonly entries: readonly SearchResult[];
  readonly totalCount: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE = 1;

/**
 * Internal hook that provides paginated, scope-aware resource listing.
 *
 * Powers the public resource list hooks (`useAgentList`, `useSkillList`,
 * `useMcpServerList`) — not exported from the public API.
 *
 * Unlike {@link useResourceSearch} which manages its own debounced query
 * state for picker/type-ahead UX, this hook accepts all parameters
 * externally, giving the consumer full control over query timing,
 * pagination state, and scope toggling.
 */
export function useResourceList(
  listFn: (params: ListParams) => Promise<ListResult>,
  org: string | null,
  options?: UseResourceListOptions,
): UseResourceListReturn {
  const [entries, setEntries] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = options?.page ?? DEFAULT_PAGE;
  const query = options?.query;
  const scope = options?.scope ?? "org";

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setEntries([]);
      setTotalCount(0);
      setTotalPages(0);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    const params: ListParams = {
      org,
      query: query || undefined,
      excludePublic: false,
      crossOrgPublic: scope === "all",
      page: { num: page, size: pageSize },
    };

    listFn(params).then(
      (result) => {
        if (cancelled.current) return;
        setEntries([...result.entries]);
        setTotalCount(result.totalCount);
        setTotalPages(result.totalPages);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load resources",
        );
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [listFn, org, query, scope, page, pageSize, fetchKey]);

  return {
    entries,
    totalCount,
    totalPages,
    currentPage: page,
    isLoading,
    error,
    refetch,
  };
}
