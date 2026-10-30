"use client";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
 * Lists the organization's agents, newest first, while nothing is typed
 * and searches them once something is, with a debounce, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering; the {@link AgentPicker}
 * styled component uses it internally. Results are the given
 * organization's agents the caller may read.
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
  return useResourceSearch(ApiResourceKind.agent, org, options);
}
