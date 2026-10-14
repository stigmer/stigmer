"use client";

/**
 * Data hook for an agent's evals, newest first, as the agent's Evals tab
 * lists them.
 *
 * The list is a summary, as a plugin eval's is: each eval with its
 * plugins, aggregates and scores, its tries possibly emptied, so a view
 * that shows tries reads the one eval through `useAgentEval`. While an
 * eval on the first page is pending or running that page is read again
 * every {@link AGENT_EVAL_POLL_MS}, so a row shows the eval finished once
 * it has; it stops once all there have finished. A poll refreshes only the
 * first page, so only its rows start one (a new eval lands there, newest
 * first). An empty agent id asks nothing.
 * Pinned by `__tests__/hooks.test.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ListAgentEvalsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import { isEvalActive } from "../plugin-eval/eval-view.js";
import { AGENT_EVAL_POLL_MS } from "./useAgentEval.js";

/** Return value of {@link useAgentEvals}. */
export interface UseAgentEvalsReturn {
  /** The agent's evals, newest first; empty while loading. */
  readonly evals: readonly AgentEval[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list (after starting or cancelling an eval). */
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
 * Data hook that lists an agent's {@link AgentEval}s, newest first,
 * through `agenteval.listByAgent()`. An eval's access is its agent's.
 *
 * Pass an empty `agentId` to skip fetching, while the agent is loading.
 *
 * @example
 * ```tsx
 * const { evals } = useAgentEvals(agent?.metadata?.id ?? "");
 * ```
 */
export function useAgentEvals(agentId: string): UseAgentEvalsReturn {
  const stigmer = useStigmer();
  // Asks again while the last answer holds an eval that has not finished.
  const [polling, setPolling] = useState(false);

  const pages = useCursorPages<AgentEval>(
    agentId
      ? (pageToken) =>
          stigmer.agenteval.listByAgent(
            create(ListAgentEvalsByAgentRequestSchema, { agentId, pageToken }),
          )
      : null,
    [agentId, stigmer],
    (row) => row.metadata?.id ?? "",
    { refetchInterval: polling ? AGENT_EVAL_POLL_MS : false },
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
