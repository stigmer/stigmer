"use client";

/**
 * Behavior hook that starts an agent eval and keeps the server's refusal
 * as `error`.
 *
 * The input is passed through unchanged: the form's rules are in
 * `agent-eval-view.ts`, and the server checks every limit again, so the
 * hook adds none. The error is also rethrown, so a caller that awaits
 * `start` can stop on it. Pinned by `__tests__/hooks.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEvalInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useStartAgentEval}. */
export interface UseStartAgentEvalReturn {
  /** Start an eval; resolves with it, pending, as the server stored it. */
  readonly start: (input: AgentEvalInput) => Promise<AgentEval>;
  /** `true` while the create is in flight. */
  readonly isStarting: boolean;
  /** Error from the last failed start, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that starts an {@link AgentEval} through
 * `agenteval.create()`. Only the agent's editors may; the server's refusal
 * (an agent whose plugins have no eval cases, a plugin it does not attach,
 * more tries than an eval may run, a missing permission) is surfaced as
 * `error`. The eval's organization pays for every try and every AI-graded
 * check.
 *
 * @example
 * ```tsx
 * const { start } = useStartAgentEval();
 * // Unnamed: the server names the eval by its id.
 * const started = await start({ name: "", org, agentId, maxCostUsd: 5 });
 * ```
 */
export function useStartAgentEval(): UseStartAgentEvalReturn {
  const stigmer = useStigmer();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const start = useCallback(
    async (input: AgentEvalInput): Promise<AgentEval> => {
      setIsStarting(true);
      setError(null);
      try {
        return await stigmer.agenteval.create(input);
      } catch (err) {
        const failure = toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsStarting(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ start, isStarting, error, clearError }),
    [start, isStarting, error, clearError],
  );
}
