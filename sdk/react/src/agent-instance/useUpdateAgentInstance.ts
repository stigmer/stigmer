"use client";

import { useCallback, useState } from "react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentInstanceInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateAgentInstance}. */
export interface UseUpdateAgentInstanceReturn {
  /** Update an existing agent instance with a full input. Returns the updated resource. */
  readonly update: (input: AgentInstanceInput) => Promise<AgentInstance>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that updates an existing AgentInstance resource.
 *
 * Wraps `stigmer.agentInstance.update()` with loading/error state.
 * The caller is responsible for refreshing the instance after a
 * successful update (e.g., via `refetch` from `useAgentInstances` or
 * `useAgentInstance`).
 *
 * @example
 * ```tsx
 * const { update, isUpdating } = useUpdateAgentInstance();
 *
 * const handleSave = async () => {
 *   await update({
 *     ...toAgentInstanceUpdateInput(instance),
 *     environmentRefs: newRefs,
 *   });
 *   refetch();
 * };
 * ```
 */
export function useUpdateAgentInstance(): UseUpdateAgentInstanceReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: AgentInstanceInput): Promise<AgentInstance> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.agentInstance.update(input);
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
