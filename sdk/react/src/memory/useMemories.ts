"use client";

import { create } from "@bufbuild/protobuf";
import type { Memory } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
import { ListMemoriesRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { LIST_PAGE_MAX, readEveryPage } from "@stigmer/react-core/internal";
import { useFetch } from "@stigmer/react-core/internal";


/** Return value of {@link useMemories}. */
export interface UseMemoriesReturn {
  /** Every memory the caller can view in the org, newest first. */
  readonly memories: readonly Memory[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the caller's memories in an organization.
 *
 * Memory content is subject-only: the server returns exactly the records
 * that are about the caller (FGA-filtered in cloud; single-user in local
 * mode), so this list is always "what the platform remembers about ME
 * here". Ordering is newest first; group by lifecycle state for display
 * with {@link groupMemoriesByLifecycle}.
 *
 * The server holds at most 100 records per subject in an organization, so
 * the view needs no pager, but a page is not the whole set: the server
 * checks each row against the caller's read scope after reading it, so a
 * page can come back short, even empty, with a token while the caller's
 * own records sit further on. The hook follows every token.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { memories, isLoading, refetch } = useMemories(org);
 * const groups = groupMemoriesByLifecycle(memories);
 * ```
 */
export function useMemories(org: string | null): UseMemoriesReturn {
  const stigmer = useStigmer();

  const { data: memories, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          readEveryPage((pageToken) =>
            stigmer.memory.list(
              create(ListMemoriesRequestSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )
      : null,
    [stigmer, org],
    [] as Memory[],
  );

  return { memories, isLoading, isRefetching, error, refetch };
}
