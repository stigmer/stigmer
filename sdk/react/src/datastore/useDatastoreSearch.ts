"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import {
  useResourceSearch,
  type UseResourceSearchOptions,
  type UseResourceSearchReturn,
} from "../search/index.js";

/** Options for {@link useDatastoreSearch}. Delegates to the shared resource search options. */
export type UseDatastoreSearchOptions = UseResourceSearchOptions;
/** Return value of {@link useDatastoreSearch}. Delegates to the shared resource search return. */
export type UseDatastoreSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches datastores available in the given organization.
 *
 * Wraps `stigmer.datastore.list()` with debounced search, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering.
 *
 * @example
 * ```tsx
 * const { results, isLoading, query, setQuery } = useDatastoreSearch("acme");
 * ```
 */
export function useDatastoreSearch(
  org: string,
  options?: UseDatastoreSearchOptions,
): UseDatastoreSearchReturn {
  const stigmer = useStigmer();
  const listFn = useCallback(
    (params: Parameters<typeof stigmer.datastore.list>[0]) =>
      stigmer.datastore.list(params),
    [stigmer],
  );
  return useResourceSearch(listFn, org, options);
}
