"use client";

/**
 * Data hook for an organization's Evals, newest first, as an agent's Evals
 * tab offers them as sources of the cases an eval run runs.
 *
 * An Eval is the `evals/` folder of test cases a team pushes with
 * `stigmer push eval`, kept beside the agent rather than inside a plugin.
 * Evals are not search-indexed, so the list reads `eval.list` page by page
 * rather than the search lane the library lists ride; the server answers
 * only the Evals the caller may view. An empty organization asks nothing.
 * Pinned by `__tests__/hooks.test.tsx`.
 */

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { Eval } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { ListEvalsRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Return value of {@link useEvals}. */
export interface UseEvalsReturn {
  /** The organization's Evals the caller may view, newest first; empty while loading. */
  readonly evals: readonly Eval[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list (after a push). */
  readonly refetch: () => void;
  /** `true` while the server holds entries beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
}

/**
 * Data hook that lists the {@link Eval}s of an organization through
 * `eval.list()`, newest first, each one the caller may view.
 *
 * Pass an empty organization to skip fetching, while the agent is loading
 * or where no Eval applies.
 *
 * @example
 * ```tsx
 * const { evals } = useEvals(agent?.metadata?.org ?? "");
 * ```
 */
export function useEvals(org: string): UseEvalsReturn {
  const stigmer = useStigmer();
  const pages = useCursorPages<Eval>(
    org !== ""
      ? (pageToken) => stigmer.eval.list(create(ListEvalsRequestSchema, { org, pageToken }))
      : null,
    [org, stigmer],
    (row) => row.metadata?.id ?? "",
  );

  const { items, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } = pages;
  return useMemo(
    () => ({ evals: items, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch }),
    [items, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch],
  );
}
