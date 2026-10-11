"use client";

/**
 * Searching the organization's installed plugins by name, description or
 * keyword: the data layer under `PluginPicker`, the shared resource search
 * over the plugin kind's listing, as every picker's search is.
 */

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import {
  useResourceSearch,
  type UseResourceSearchOptions,
  type UseResourceSearchReturn,
} from "../search/index.js";

/** Options for {@link usePluginSearch}. Delegates to the shared resource search options. */
export type UsePluginSearchOptions = UseResourceSearchOptions;
/** Return value of {@link usePluginSearch}. Delegates to the shared resource search return. */
export type UsePluginSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches the plugins installed in the given organization.
 *
 * Wraps `stigmer.plugin.list()` with debounced search, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering; the {@link PluginPicker}
 * styled component uses it internally.
 *
 * @example
 * ```tsx
 * const { results, isLoading, query, setQuery } = usePluginSearch("acme");
 * ```
 */
export function usePluginSearch(
  org: string,
  options?: UsePluginSearchOptions,
): UsePluginSearchReturn {
  const stigmer = useStigmer();
  const listFn = useCallback(
    (params: Parameters<typeof stigmer.plugin.list>[0]) =>
      stigmer.plugin.list(params),
    [stigmer],
  );
  return useResourceSearch(listFn, org, options);
}
