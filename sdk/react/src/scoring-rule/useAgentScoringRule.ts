"use client";

import { create } from "@bufbuild/protobuf";
import type { ScoringRule } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { GetScoringRuleByAgentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/io_pb";
import { isNotFound } from "@stigmer/client";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentScoringRule}. */
export interface UseAgentScoringRuleReturn {
  /**
   * The agent's scoring rule, or `null` when the agent has none (AI grading
   * is off) or while loading.
   */
  readonly scoringRule: ScoringRule | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the scoring rule (after a save). */
  readonly refetch: () => void;
}

/**
 * Data hook that loads an agent's {@link ScoringRule}, the setting that
 * switches AI grading on for it, through `scoringrule.getByAgent()`. Anyone
 * who can view the agent can read it; an agent with grading off answers
 * `null`.
 *
 * Pass an empty `agentId` to skip fetching, while the agent is loading.
 *
 * @example
 * ```tsx
 * const { scoringRule } = useAgentScoringRule(agent?.metadata?.id ?? "");
 * ```
 */
export function useAgentScoringRule(agentId: string): UseAgentScoringRuleReturn {
  const stigmer = useStigmer();

  const { data, isLoading, error, refetch } = useFetch(
    agentId
      ? async (): Promise<ScoringRule | null> => {
          try {
            return await stigmer.scoringrule.getByAgent(
              create(GetScoringRuleByAgentRequestSchema, { agentId }),
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

  return { scoringRule: data, isLoading, error, refetch };
}
