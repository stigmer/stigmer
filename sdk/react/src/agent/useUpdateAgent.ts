"use client";

import { useCallback, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateAgent}. */
export interface UseUpdateAgentReturn {
  /** Update an existing agent with a full input. Returns the updated resource. */
  readonly update: (input: AgentInput) => Promise<Agent>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that updates an existing Agent resource.
 *
 * Wraps `stigmer.agent.update(input)` with loading and error state.
 * The caller must provide a **complete** `AgentInput` — the backend
 * performs full spec replacement. Use `agentToInput()` to reconstruct
 * the input from a fetched agent, modify the desired field, and pass
 * the result here.
 */
export function useUpdateAgent(): UseUpdateAgentReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: AgentInput): Promise<Agent> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.agent.update(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
