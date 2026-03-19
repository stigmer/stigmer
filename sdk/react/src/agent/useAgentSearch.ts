"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks";
import {
  useResourceSearch,
  type UseResourceSearchOptions,
  type UseResourceSearchReturn,
} from "../search";

export type UseAgentSearchOptions = UseResourceSearchOptions;
export type UseAgentSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches agents available in the given organization.
 *
 * Wraps `stigmer.agent.list()` with debounced search, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering; the {@link AgentPicker}
 * styled component uses it internally.
 *
 * This is a Layer 1 building-block hook used by both platform builders
 * (Profile A) and direct Stigmer users (Profile B). Platform builders
 * can use it standalone to build custom agent selection UIs. The
 * Stigmer Console composes it via higher-level orchestration hooks.
 *
 * @example
 * ```tsx
 * const { results, isLoading, query, setQuery } = useAgentSearch("acme");
 * ```
 */
export function useAgentSearch(
  org: string,
  options?: UseAgentSearchOptions,
): UseAgentSearchReturn {
  const stigmer = useStigmer();
  const listFn = useCallback(
    (params: Parameters<typeof stigmer.agent.list>[0]) =>
      stigmer.agent.list(params),
    [stigmer],
  );
  return useResourceSearch(listFn, org, options);
}
