"use client";

import { useCallback, useState } from "react";
import { useStigmer } from "../hooks";

export interface CreateAgentExecutionInput {
  readonly org: string;
  readonly sessionId: string;
  readonly message: string;
  readonly modelName?: string;
  readonly agentId?: string;
}

export interface CreateAgentExecutionResult {
  readonly executionId: string;
  readonly sessionId: string;
}

export interface UseCreateAgentExecutionReturn {
  readonly create: (
    input: CreateAgentExecutionInput,
  ) => Promise<CreateAgentExecutionResult>;
  readonly isCreating: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `agentExecution.create()` with loading/error
 * state.
 *
 * Maps 1:1 to the AgentExecution aggregate — a single run of an agent
 * within an existing session. Requires a `sessionId`; use
 * {@link useCreateSession} to create the session first.
 */
export function useCreateAgentExecution(): UseCreateAgentExecutionReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (
      input: CreateAgentExecutionInput,
    ): Promise<CreateAgentExecutionResult> => {
      setIsCreating(true);
      setError(null);

      try {
        const execution = await stigmer.agentExecution.create({
          name: `execution-${Date.now()}`,
          org: input.org,
          sessionId: input.sessionId,
          agentId: input.agentId,
          message: input.message,
          executionConfig: input.modelName
            ? { modelName: input.modelName }
            : undefined,
        });

        return {
          executionId: execution.metadata!.id,
          sessionId: input.sessionId,
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to create agent execution";
        setError(message);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
