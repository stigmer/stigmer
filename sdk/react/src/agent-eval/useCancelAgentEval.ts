"use client";

/**
 * Behavior hook that cancels a running agent eval and keeps a refusal as
 * `error`, cleared by the next cancel.
 *
 * The hook only cancels; a view that shows the eval reads it again after
 * (the results view does), so the list and the view show it as it ends.
 * Pinned by `__tests__/hooks.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCancelAgentEval}. */
export interface UseCancelAgentEvalReturn {
  /** Cancel an eval by id; resolves with it as the server stored it. */
  readonly cancel: (id: string) => Promise<AgentEval>;
  /** `true` while the cancel is in flight. */
  readonly isCancelling: boolean;
  /** Error from the last failed cancel, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that cancels a pending or running {@link AgentEval}
 * through `agenteval.cancel()`. Tries in flight are stopped; the eval ends
 * partial, "cancelled", with the results of the tries that finished.
 * Cancelling a finished eval changes nothing. Only the agent's editors
 * may.
 *
 * @example
 * ```tsx
 * const { cancel } = useCancelAgentEval();
 * await cancel(agentEval.metadata.id);
 * ```
 */
export function useCancelAgentEval(): UseCancelAgentEvalReturn {
  const stigmer = useStigmer();
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cancel = useCallback(
    async (id: string): Promise<AgentEval> => {
      setIsCancelling(true);
      setError(null);
      try {
        return await stigmer.agenteval.cancel(id);
      } catch (err) {
        const failure = toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsCancelling(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ cancel, isCancelling, error }),
    [cancel, isCancelling, error],
  );
}
