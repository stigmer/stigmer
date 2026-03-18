"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks";
import {
  useResourceSearch,
  type UseResourceSearchOptions,
  type UseResourceSearchReturn,
} from "../search";

export type UseMcpServerSearchOptions = UseResourceSearchOptions;
export type UseMcpServerSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches MCP servers available in the given organization.
 *
 * Wraps `stigmer.mcpServer.list()` with debounced search, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering; the {@link McpServerPicker}
 * styled component uses it internally.
 *
 * @example
 * ```tsx
 * const { results, isLoading, query, setQuery } = useMcpServerSearch("acme");
 * ```
 */
export function useMcpServerSearch(
  org: string,
  options?: UseMcpServerSearchOptions,
): UseMcpServerSearchReturn {
  const stigmer = useStigmer();
  const listFn = useCallback(
    (params: Parameters<typeof stigmer.mcpServer.list>[0]) =>
      stigmer.mcpServer.list(params),
    [stigmer],
  );
  return useResourceSearch(listFn, org, options);
}
