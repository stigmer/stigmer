"use client";

import { useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Options for {@link useSessionList}. */
export interface UseSessionListOptions {
  /** Maximum sessions to return. Defaults to 50. */
  pageSize?: number;
  /** Optional tag filter. */
  tags?: string[];
}

/** Return value of {@link useSessionList}. */
export interface UseSessionListReturn {
  /** The fetched list of Sessions, empty while loading or on error. */
  readonly sessions: readonly Session[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the session list from the server. */
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Data hook that fetches a paginated list of {@link Session} entries.
 *
 * Org scoping is handled at the transport level (auth context),
 * consistent with other data hooks. Call `refetch()` to re-query
 * after creating a session or navigating between views.
 *
 * Returns up to `pageSize` sessions (default 50). Full cursor-based
 * pagination can be added later without breaking the return type.
 *
 * @example
 * ```tsx
 * function SessionSidebar() {
 *   const { sessions, isLoading, refetch } = useSessionList({ pageSize: 25 });
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <ul>
 *       {sessions.map((s) => (
 *         <li key={s.metadata?.id}>
 *           {s.status?.subject ?? "Untitled"}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useSessionList(
  options?: UseSessionListOptions,
): UseSessionListReturn {
  const stigmer = useStigmer();

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const tagsRef = useRef(options?.tags);

  if (
    options?.tags !== tagsRef.current &&
    JSON.stringify(options?.tags) !== JSON.stringify(tagsRef.current)
  ) {
    tagsRef.current = options?.tags;
  }
  const tags = tagsRef.current;

  const { data: sessions, isLoading, isRefetching, error, refetch } = useFetch(
    () =>
      stigmer.session
        .list(
          create(ListSessionsRequestSchema, {
            pageSize,
            tags: tags ?? [],
          }),
        )
        .then((result) => result.entries),
    [stigmer, pageSize, tags],
    [] as Session[],
  );

  return { sessions, isLoading, isRefetching, error, refetch };
}
