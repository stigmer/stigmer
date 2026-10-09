"use client";

import { create } from "@bufbuild/protobuf";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { GetEvaluatorByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/io_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentEvaluator}. */
export interface UseAgentEvaluatorReturn {
  /**
   * The agent's evaluator, or `null` when the agent has none (AI grading
   * is off) or while loading.
   */
  readonly evaluator: Evaluator | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the evaluator (after a save). */
  readonly refetch: () => void;
}

/**
 * Data hook that loads an agent's {@link Evaluator}, the setting that
 * switches AI grading on for it, through `evaluator.getByAgent()`. Anyone
 * who can view the agent can read it; an agent with grading off answers
 * `null`.
 *
 * Pass an empty `agentId` to skip fetching, while the agent is loading.
 *
 * @example
 * ```tsx
 * const { evaluator } = useAgentEvaluator(agent?.metadata?.id ?? "");
 * ```
 */
export function useAgentEvaluator(agentId: string): UseAgentEvaluatorReturn {
  const stigmer = useStigmer();

  const { data, isLoading, error, refetch } = useFetch(
    agentId
      ? async (): Promise<Evaluator | null> => {
          try {
            return await stigmer.evaluator.getByAgent(
              create(GetEvaluatorByAgentRequestSchema, { agentId }),
            );
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [agentId, stigmer],
    null,
  );

  return { evaluator: data, isLoading, error, refetch };
}
