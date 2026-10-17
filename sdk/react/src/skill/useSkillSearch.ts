"use client";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
 * Lists the organization's skills, newest first, while nothing is typed
 * and searches them once something is, with a debounce, loading/error
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
  return useResourceSearch(ApiResourceKind.skill, org, options);
}
