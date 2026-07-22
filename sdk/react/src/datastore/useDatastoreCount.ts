"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import { useResourceCount, type ResourceListScope } from "../search/index.js";

/** Options for {@link useDatastoreCount}. */
export interface UseDatastoreCountOptions {
  /** Text query to filter datastores before counting. */
  readonly query?: string;
  /**
   * Controls which datastores are counted.
   *
   * - `"org"` — only datastores owned by the given organization.
   * - `"all"` — includes public/platform datastores.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

/** Return value of {@link useDatastoreCount}. */
export interface UseDatastoreCountReturn {
  /**
   * Total number of datastores matching the current filters. `undefined`
   * until the first successful fetch completes.
   */
  readonly count: number | undefined;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of datastores.
 *
 * Issues a minimal `stigmer.datastore.list()` call to retrieve only the
 * total count — no datastore entries are returned or stored. Useful for
 * the Library landing card and dashboard widgets.
 *
 * For the full paginated datastore list, use {@link useDatastoreList}
 * instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLoading } = useDatastoreCount("acme");
 * ```
 */
export function useDatastoreCount(
  org: string | null,
  options?: UseDatastoreCountOptions,
): UseDatastoreCountReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.datastore.list>[0]) =>
      stigmer.datastore.list(params),
    [stigmer],
  );

  return useResourceCount(listFn, org, options);
}
