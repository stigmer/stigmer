"use client";

import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useResourceList } from "@stigmer/react-core/internal";

/** Options for {@link useSkillList}. */
export interface UseSkillListOptions {
  /** Maximum skills per page, the first and each `loadMore`. @default 20 */
  readonly pageSize?: number;
  /** Text query to filter skills by name, description, or tags. */
  readonly query?: string;
}

/** Return value of {@link useSkillList}. */
export interface UseSkillListReturn {
  /** The first page of skills, then every page loaded since. */
  readonly skills: readonly SearchResult[];
  /** `true` while the server holds skills beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the first page; pages loaded since stay. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists an organization's skills for the Library, a page at
 * a time: `stigmer.skill.list()` newest first while `query` is empty,
 * search matches while it holds text. All parameters are externally
 * controlled — the consumer manages query debouncing. A list carries no
 * total; use {@link useSkillCount} for a count.
 *
 * For picker/type-ahead search with internal debouncing and query
 * state management, use {@link useSkillSearch} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { skills, hasMore, loadMore, isLoading } = useSkillList("acme", { pageSize: 20 });
 * ```
 */
export function useSkillList(
  org: string | null,
  options?: UseSkillListOptions,
): UseSkillListReturn {
  const { entries, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } =
    useResourceList(ApiResourceKind.skill, org, options);

  return { skills: entries, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch };
}
