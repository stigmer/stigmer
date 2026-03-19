"use client";

import { useCallback, useState } from "react";
import type { EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks";

export interface CreateAgentExecutionInput {
  readonly org: string;
  readonly sessionId: string;
  readonly message: string;
  readonly modelName?: string;
  readonly agentId?: string;
  /**
   * Execution-scoped secrets and configuration (Execution Flow).
   *
   * Values are injected into the agent sandbox for this execution only
   * and deleted when the execution completes. They take the highest
   * merge priority, overriding both Environment values and agent
   * defaults.
   *
   * Use this for B2B integrations where per-call credentials are
   * injected at runtime, or for one-off secrets that should not persist.
   *
   * For persistent credentials that are reused across executions, use
   * the Environment Flow instead (store secrets in an Environment
   * resource and bind them via an AgentInstance).
   *
   * @see {@link https://docs.stigmer.ai/product/how-to-provide-secrets | How to Provide Secrets}
   */
  readonly runtimeEnv?: Record<string, EnvVarInput>;
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
 *
 * Supports both secret delivery flows:
 *
 * - **Environment Flow** — Secrets are stored in Environment resources
 *   and bound via AgentInstance. No `runtimeEnv` needed; the backend
 *   resolves credentials from the session's agent instance.
 * - **Execution Flow** — Pass `runtimeEnv` to inject per-execution
 *   secrets. Values are merged with the highest priority and deleted
 *   when the execution completes.
 *
 * @example
 * ```tsx
 * // Environment Flow: secrets come from the agent instance's environments
 * const { create } = useCreateAgentExecution();
 * await create({ org: "acme", sessionId: "ses_abc", message: "Review the PR" });
 * ```
 *
 * @example
 * ```tsx
 * // Execution Flow: inject per-call secrets
 * const { create } = useCreateAgentExecution();
 * await create({
 *   org: "acme",
 *   sessionId: "ses_abc",
 *   message: "Deploy to production",
 *   runtimeEnv: {
 *     CUSTOMER_API_KEY: { value: "cust_xyz...", isSecret: true },
 *   },
 * });
 * ```
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
          runtimeEnv: input.runtimeEnv,
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
