"use client";

import { create } from "@bufbuild/protobuf";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ListMemoriesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/**
 * The server-enforced per-subject-per-org record ceiling (all lifecycle
 * states). Requesting one page of exactly this size fetches EVERY record
 * the caller can see, by construction — the cap is why this list needs
 * no pagination UI.
 */
const MEMORY_CAP = 100;

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
          stigmer.memory
            .list(create(ListMemoriesRequestSchema, {
              org,
              pageInfo: { num: 1, size: MEMORY_CAP },
            }))
            .then((r) => [...r.items])
      : null,
    [stigmer, org],
    [] as Memory[],
  );

  return { memories, isLoading, isRefetching, error, refetch };
}
