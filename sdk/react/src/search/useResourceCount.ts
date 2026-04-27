"use client";

import type { ListParams, ListResult } from "@stigmer/sdk";
import type { ResourceListScope } from "./useResourceList";
import { useFetch } from "../internal/useFetch";

export interface UseResourceCountOptions {
  /** Text query to filter results before counting. */
  readonly query?: string;
  /**
   * Controls resource visibility scope.
   *
   * - `"org"` — all resources owned by the given organization, regardless of visibility.
   * - `"all"` — all resources the caller is authorized to access, across all organizations.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

export interface UseResourceCountReturn {
  /**
   * Total count of matching resources. `undefined` until the first
   * successful fetch completes — distinguishes "not yet loaded" from
   * "loaded, count is zero."
   */
  readonly count: number | undefined;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Internal hook that fetches the total count of a resource type.
 *
 * Powers the public resource count hooks (`useAgentCount`, `useSkillCount`,
 * `useMcpServerCount`) — not exported from the public API.
 *
 * Issues a minimal `list()` call with `page: { num: 1, size: 1 }` and
 * reads only `totalCount` from the response. The single returned entry
 * is discarded — no entries state is maintained.
 *
 * Unlike {@link useResourceList} which manages full pagination state
 * (entries, page, pageSize, totalPages), this hook tracks only the
 * scalar count, resulting in fewer state updates and re-renders.
 */
export function useResourceCount(
  listFn: (params: ListParams) => Promise<ListResult>,
  org: string | null,
  options?: UseResourceCountOptions,
): UseResourceCountReturn {
  const query = options?.query;
  const scope = options?.scope ?? "org";

  const { data: count, isLoading, isRefetching, error, refetch } = useFetch<number | undefined>(
    org
      ? async () => {
          const params: ListParams = {
            org: scope === "all" ? "" : org,
            query: query || undefined,
            excludePublic: false,
            page: { num: 1, size: 1 },
          };
          const result = await listFn(params);
          return result.totalCount;
        }
      : null,
    [listFn, org, query, scope],
    undefined,
  );

  return { count, isLoading, isRefetching, error, refetch };
}
