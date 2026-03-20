"use client";

import { useCallback, useEffect, useState } from "react";
import type { ListParams, ListResult } from "@stigmer/sdk";
import type { ResourceListScope } from "./useResourceList";

export interface UseResourceCountOptions {
  /** Text query to filter results before counting. */
  readonly query?: string;
  /**
   * Controls resource visibility scope.
   *
   * - `"org"` — only resources owned by the given organization (excludes public/platform resources).
   * - `"all"` — includes public/platform resources alongside the org's own resources.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

export interface UseResourceCountReturn {
  readonly count: number;
  readonly isLoading: boolean;
  readonly error: string | null;
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
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const query = options?.query;
  const scope = options?.scope ?? "org";

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setCount(0);
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
      excludePublic: scope === "org",
      page: { num: 1, size: 1 },
    };

    listFn(params).then(
      (result) => {
        if (cancelled.current) return;
        setCount(result.totalCount);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load resource count",
        );
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [listFn, org, query, scope, fetchKey]);

  return { count, isLoading, error, refetch };
}
