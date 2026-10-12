"use client";

/**
 * Data hook for an agent's evals, newest first, as the agent's Evals tab
 * lists them.
 *
 * The list is a summary, as a plugin eval's is: each eval with its
 * plugins, aggregates and scores, its tries possibly emptied, so a view
 * that shows tries reads the one eval through `useAgentEval`. While any
 * listed eval is pending or running the list is read again every
 * {@link AGENT_EVAL_POLL_MS}, so a row shows the eval finished once it
 * has; it stops once all have finished. An empty agent id asks nothing.
 * Pinned by `__tests__/hooks.test.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ListAgentEvalsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
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
}

const NO_EVALS: readonly AgentEval[] = [];

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

  const { data, isLoading, error, refetch } = useFetch(
    agentId
      ? async (): Promise<readonly AgentEval[]> =>
          (
            await stigmer.agenteval.listByAgent(
              create(ListAgentEvalsByAgentRequestSchema, { agentId }),
            )
          ).items
      : null,
    [agentId, stigmer],
    NO_EVALS,
    { refetchInterval: polling ? AGENT_EVAL_POLL_MS : false },
  );

  useEffect(() => {
    setPolling(data.some(isEvalActive));
  }, [data]);

  return useMemo(
    () => ({ evals: data, isLoading, error, refetch }),
    [data, isLoading, error, refetch],
  );
}
