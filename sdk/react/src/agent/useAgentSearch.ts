"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import {
  useResourceSearch,
  type UseResourceSearchOptions,
  type UseResourceSearchReturn,
} from "../search/index.js";

/** Options for {@link useAgentSearch}. Delegates to the shared resource search options. */
export type UseAgentSearchOptions = UseResourceSearchOptions;
/** Return value of {@link useAgentSearch}. Delegates to the shared resource search return type. */
export type UseAgentSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches agents available to the user.
 *
 * Wraps `stigmer.agent.list()` with debounced search, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering; the {@link AgentPicker}
 * styled component uses it internally.
 *
 * By default, searches within the given organization (`scope: "org"`).
 * Pass `scope: "all"` to search across all organizations the caller
 * can access, including public/platform agents from other orgs.
 *
 * This is a Layer 1 building-block hook used by both platform builders
 * (Profile A) and direct Stigmer users (Profile B). Platform builders
 * can use it standalone to build custom agent selection UIs. The
 * Stigmer Console composes it via higher-level orchestration hooks.
 *
 * @example
 * ```tsx
 * // Org-scoped (default)
 * const { results, isLoading, query, setQuery } = useAgentSearch("acme");
 *
 * // Cross-org: include public agents from all accessible orgs
 * const { results } = useAgentSearch("acme", { scope: "all" });
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
