"use client";

import { useMemo, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Options for {@link useSessionList}. */
export interface UseSessionListOptions {
  /** Sessions per page, the first and each `loadMore`. Defaults to 50; the server caps it at 100. */
  pageSize?: number;
  /** Optional tag filter. */
  tags?: string[];
  /**
   * Organization slug to list the sessions of. When omitted, the list spans
   * every organization the caller can view. Console pages should pass the
   * active org (`useActiveOrgSlug()`).
   */
  org?: string | null;
}

/** Return value of {@link useSessionList}. */
export interface UseSessionListReturn {
  /** Sessions newest first: the first page, then every page loaded since. Empty while loading or on error. */
  readonly sessions: readonly Session[];
  /** `true` while more sessions exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page of older sessions. No-op while one is loading. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. Cleared on retry. */
  readonly loadMoreError: Error | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the first page (after creating a session, say); loaded older pages stay. */
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 50;

function sessionIdentity(session: Session): string {
  return session.metadata?.id ?? "";
}

/**
 * Data hook that lists {@link Session} entries newest first, one page at a
 * time.
 *
 * The first `pageSize` sessions (default 50) load on mount; `loadMore()`
 * appends the next page while `hasMore` is true. Pass `org` to list one
 * organization's sessions; without it the list spans every organization
 * the caller can view. Call `refetch()` to re-query after creating a
 * session or navigating between views.
 *
 * @example
 * ```tsx
 * function SessionSidebar() {
 *   const org = useActiveOrgSlug();
 *   const { sessions, isLoading, hasMore, loadMore, isLoadingMore } =
 *     useSessionList({ org, pageSize: 25 });
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <ul>
 *       {sessions.map((s) => (
 *         <li key={s.metadata?.id}>
 *           {s.spec?.subject || "Untitled"}
 *         </li>
 *       ))}
 *       {hasMore && (
 *         <button onClick={loadMore} disabled={isLoadingMore}>Show more</button>
 *       )}
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
  const org = options?.org ?? "";
  const tagsRef = useRef(options?.tags);

  if (
    options?.tags !== tagsRef.current &&
    JSON.stringify(options?.tags) !== JSON.stringify(tagsRef.current)
  ) {
    tagsRef.current = options?.tags;
  }
  const tags = tagsRef.current;

  const list = useCursorPages(
    (pageToken) =>
      stigmer.session.list(
        create(ListSessionsRequestSchema, {
          org,
          pageSize,
          pageToken,
          tags: tags ?? [],
        }),
      ),
    [stigmer, org, pageSize, tags],
    sessionIdentity,
  );

  const { items, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, isRefetching, error, refetch } = list;
  return useMemo(
    () => ({
      sessions: items,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [items, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, isRefetching, error, refetch],
  );
}
