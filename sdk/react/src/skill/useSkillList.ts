"use client";

import { useCallback } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks";
import { useResourceList, type ResourceListScope } from "../search";

/** Options for {@link useSkillList}. */
export interface UseSkillListOptions {
  /** Maximum skills per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter skills by name, description, or tags. */
  readonly query?: string;
  /**
   * Controls which skills are visible.
   *
   * - `"org"` — only skills owned by the given organization.
   * - `"all"` — includes public/platform skills.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

/** Return value of {@link useSkillList}. */
export interface UseSkillListReturn {
  /** Paginated skill entries for the current page. */
  readonly skills: readonly SearchResult[];
  /** Total number of skills matching the current filters. */
  readonly totalCount: number;
  /** Total pages available at the current page size. */
  readonly totalPages: number;
  /** The current page number (mirrors the `page` option). */
  readonly currentPage: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a paginated list of skills for the Library.
 *
 * Wraps `stigmer.skill.list()` with pagination, scope filtering,
 * and text search. All parameters are externally controlled — the
 * consumer manages page state, query debouncing, and scope toggling.
 *
 * For picker/type-ahead search with internal debouncing and query
 * state management, use {@link useSkillSearch} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { skills, totalCount, isLoading } = useSkillList("acme", {
 *   page: 1,
 *   pageSize: 20,
 *   scope: "org",
 * });
 * ```
 *
 * @example
 * ```tsx
 * // Show all skills including public/platform ones
 * const { skills } = useSkillList("acme", { scope: "all" });
 * ```
 */
export function useSkillList(
  org: string | null,
  options?: UseSkillListOptions,
): UseSkillListReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.skill.list>[0]) =>
      stigmer.skill.list(params),
    [stigmer],
  );

  const { entries, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useResourceList(listFn, org, options);

  return { skills: entries, totalCount, totalPages, currentPage, isLoading, error, refetch };
}
