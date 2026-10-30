"use client";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
/**
 * Searching the organization's installed plugins by name, description or
 * keyword: the data layer under `PluginPicker`, the shared resource search
 * over the plugin kind's listing, as every picker's search is.
 */

import { type UseResourceSearchOptions, type UseResourceSearchReturn } from "@stigmer/react-core";
import { useResourceSearch } from "@stigmer/react-core/internal";

/** Options for {@link usePluginSearch}. Delegates to the shared resource search options. */
export type UsePluginSearchOptions = UseResourceSearchOptions;
/** Return value of {@link usePluginSearch}. Delegates to the shared resource search return. */
export type UsePluginSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches the plugins installed in the given organization.
 *
 * Lists the organization's plugins, newest first, while nothing is typed
 * and searches them once something is, with a debounce, loading/error
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
  return useResourceSearch(ApiResourceKind.plugin, org, options);
}
