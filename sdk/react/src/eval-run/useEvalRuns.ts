"use client";

/**
 * Data hook for the eval runs of an agent or of a plugin, newest first, as
 * their Evals tab lists them.
 *
 * The list is a summary: the server returns each eval run with its
 * plugins, aggregates and scores, its tries possibly emptied, so a long
 * history stays small and a view that shows tries reads the one eval run
 * through `useEvalRun`. While an eval run on the first page is pending or
 * running that page is read again every {@link EVAL_RUN_POLL_MS}, so a row
 * shows it finished once it has; it stops once all there have finished. A
 * poll refreshes only the first page, so only its rows start one (a new
 * eval run lands there, newest first). An empty id asks nothing. Pinned by
 * `__tests__/hooks.test.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  ListEvalRunsByAgentRequestSchema,
  ListEvalRunsByPluginRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import { isEvalActive } from "./eval-view.js";
import { EVAL_RUN_POLL_MS } from "./useEvalRun.js";

/** Whose eval runs to list: an agent's, or a plugin's (the ones about the plugin). */
export type EvalRunsOf = { readonly agentId: string } | { readonly pluginId: string };

/** Return value of {@link useEvalRuns}. */
export interface UseEvalRunsReturn {
  /** The eval runs, newest first; empty while loading. */
  readonly evalRuns: readonly EvalRun[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list (after starting or cancelling an eval run). */
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
 * Data hook that lists the {@link EvalRun}s of an agent through
 * `evalrun.listByAgent()`, or those about a plugin through
 * `evalrun.listByPlugin()`, newest first. An eval run's access is its
 * subject's; on a plugin, a viewer from a child organization gets an empty
 * list, because a try runs on the plugin's organization's own provider
 * keys.
 *
 * Pass an empty id to skip fetching, while the agent or plugin is loading.
 *
 * @example
 * ```tsx
 * const { evalRuns } = useEvalRuns({ agentId: agent?.metadata?.id ?? "" });
 * ```
 */
export function useEvalRuns(of: EvalRunsOf): UseEvalRunsReturn {
  const stigmer = useStigmer();
  // Asks again while the last answer holds an eval run that has not finished.
  const [polling, setPolling] = useState(false);
  const agentId = "agentId" in of ? of.agentId : "";
  const pluginId = "pluginId" in of ? of.pluginId : "";

  const pages = useCursorPages<EvalRun>(
    agentId !== ""
      ? (pageToken) =>
          stigmer.evalrun.listByAgent(
            create(ListEvalRunsByAgentRequestSchema, { agentId, pageToken }),
          )
      : pluginId !== ""
        ? (pageToken) =>
            stigmer.evalrun.listByPlugin(
              create(ListEvalRunsByPluginRequestSchema, { pluginId, pageToken }),
            )
        : null,
    [agentId, pluginId, stigmer],
    (row) => row.metadata?.id ?? "",
    { refetchInterval: polling ? EVAL_RUN_POLL_MS : false },
  );
  const data = pages.items;
  const firstPage = pages.firstPage;

  useEffect(() => {
    setPolling(firstPage?.entries.some(isEvalActive) ?? false);
  }, [firstPage]);

  const { hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } = pages;
  return useMemo(
    () => ({ evalRuns: data, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch }),
    [data, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch],
  );
}
