"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import {
  useResourceSearch,
  type UseResourceSearchOptions,
  type UseResourceSearchReturn,
} from "../search/index.js";

/** Options for {@link useSkillSearch}. Delegates to the shared resource search options. */
export type UseSkillSearchOptions = UseResourceSearchOptions;
/** Return value of {@link useSkillSearch}. Delegates to the shared resource search return. */
export type UseSkillSearchReturn = UseResourceSearchReturn;

/**
 * Data hook that searches skills available in the given organization.
 *
 * Wraps `stigmer.skill.list()` with debounced search, loading/error
 * tracking, and cancellation-safe fetching. Platform builders use this
 * when they want full control over rendering; the {@link SkillPicker}
 * styled component uses it internally.
 *
 * @example
 * ```tsx
 * const { results, isLoading, query, setQuery } = useSkillSearch("acme");
 * ```
 */
export function useSkillSearch(
  org: string,
  options?: UseSkillSearchOptions,
): UseSkillSearchReturn {
  const stigmer = useStigmer();
  const listFn = useCallback(
    (params: Parameters<typeof stigmer.skill.list>[0]) =>
      stigmer.skill.list(params),
    [stigmer],
  );
  return useResourceSearch(listFn, org, options);
}
