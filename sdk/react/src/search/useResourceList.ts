"use client";

import type { ListParams, ListResult } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useFetch } from "../internal/useFetch";

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
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE = 1;

interface ResourceListData {
  entries: readonly SearchResult[];
  totalCount: number;
  totalPages: number;
}

const INITIAL_DATA: ResourceListData = {
  entries: [],
  totalCount: 0,
  totalPages: 0,
};

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
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = options?.page ?? DEFAULT_PAGE;
  const query = options?.query;
  const scope = options?.scope ?? "org";

  const { data, isLoading, isRefetching, error, refetch } = useFetch<ResourceListData>(
    org
      ? async () => {
          const params: ListParams = {
            org,
            query: query || undefined,
            excludePublic: false,
            crossOrgPublic: scope === "all",
            page: { num: page, size: pageSize },
          };
          const result = await listFn(params);
          return {
            entries: [...result.entries],
            totalCount: result.totalCount,
            totalPages: result.totalPages,
          };
        }
      : null,
    [listFn, org, query, scope, page, pageSize],
    INITIAL_DATA,
  );

  return {
    entries: data.entries,
    totalCount: data.totalCount,
    totalPages: data.totalPages,
    currentPage: page,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
