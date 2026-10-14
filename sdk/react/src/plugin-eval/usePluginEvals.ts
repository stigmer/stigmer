"use client";

/**
 * Data hook for a plugin's evals, newest first, as the Evals tab lists
 * them.
 *
 * The list is a summary: the server returns each eval with its aggregates,
 * per-target scores and notes but its cases' tries emptied, so a long
 * history stays small; a view that shows tries reads the one eval through
 * `usePluginEval`. While an eval on the first page is pending or running
 * that page is read again every {@link PLUGIN_EVAL_POLL_MS}, so a row shows
 * the eval finished once it has; it stops once all there have finished. A
 * poll refreshes only the first page, so only its rows start one (a new
 * eval lands there, newest first). An empty plugin id asks nothing. Pinned by `__tests__/hooks.test.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ListPluginEvalsByPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import { isEvalActive } from "./eval-view.js";
import { PLUGIN_EVAL_POLL_MS } from "./usePluginEval.js";

/** Return value of {@link usePluginEvals}. */
export interface UsePluginEvalsReturn {
  /** The plugin's evals, newest first; empty while loading. */
  readonly evals: readonly PluginEval[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list (after starting or deleting an eval). */
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
 * Data hook that lists a plugin's {@link PluginEval}s, newest first,
 * through `plugineval.listByPlugin()`. The plugin's viewers in its own
 * organization read them; a viewer from a child organization gets an
 * empty list, because a try runs on the plugin's organization's own
 * provider keys.
 *
 * Pass an empty `pluginId` to skip fetching, while the plugin is loading.
 *
 * @example
 * ```tsx
 * const { evals } = usePluginEvals(plugin?.metadata?.id ?? "");
 * ```
 */
export function usePluginEvals(pluginId: string): UsePluginEvalsReturn {
  const stigmer = useStigmer();
  // Asks again while the last answer holds an eval that has not finished.
  const [polling, setPolling] = useState(false);

  const pages = useCursorPages<PluginEval>(
    pluginId
      ? (pageToken) =>
          stigmer.plugineval.listByPlugin(
            create(ListPluginEvalsByPluginRequestSchema, { pluginId, pageToken }),
          )
      : null,
    [pluginId, stigmer],
    (row) => row.metadata?.id ?? "",
    { refetchInterval: polling ? PLUGIN_EVAL_POLL_MS : false },
  );
  const data = pages.items;
  const firstPage = pages.firstPage;

  useEffect(() => {
    setPolling(firstPage?.entries.some(isEvalActive) ?? false);
  }, [firstPage]);

  const { hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } = pages;
  return useMemo(
    () => ({ evals: data, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch }),
    [data, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch],
  );
}
