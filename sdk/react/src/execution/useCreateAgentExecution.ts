"use client";

import { useCallback, useState } from "react";
import type { AttachmentInput, EnvVarInput } from "@stigmer/sdk";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

const INTERACTION_MODE_MAP: Record<string, InteractionMode> = {
  agent: InteractionMode.AGENT,
  plan: InteractionMode.PLAN,
};

/** Input for {@link UseCreateAgentExecutionReturn.create}. */
export interface CreateAgentExecutionInput {
  /** Organization slug that owns the session. */
  readonly org: string;
  /** Session to create the execution within. */
  readonly sessionId: string;
  /** User message that initiates the execution. */
  readonly message: string;
  /** Override the default model for this execution. */
  readonly modelName?: string;
  /** Explicit agent ID. When omitted, uses the session's agent instance. */
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
  /**
   * Pre-uploaded file attachments injected into the agent sandbox.
   *
   * Each entry must include a `storageKey` obtained from
   * `agentExecution.uploadAttachment()`. The agent can read attached
   * files from their mount paths (default `/inputs/{filename}`).
   */
  readonly attachments?: AttachmentInput[];
  /**
   * Interaction mode for this execution.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   *
   * Maps to `ExecutionConfig.interaction_mode` in the proto.
   */
  readonly interactionMode?: "agent" | "plan";
}

/** Resolved output of {@link UseCreateAgentExecutionReturn.create}. */
export interface CreateAgentExecutionResult {
  /** Server-assigned identifier for the newly created execution. */
  readonly executionId: string;
  /** Session the execution belongs to (echoed from input). */
  readonly sessionId: string;
}

/** Return value of {@link useCreateAgentExecution}. */
export interface UseCreateAgentExecutionReturn {
  /** Create an execution within a session. Resolves with the new execution ID. */
  readonly create: (
    input: CreateAgentExecutionInput,
  ) => Promise<CreateAgentExecutionResult>;
  /** `true` while the create RPC is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
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
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (
      input: CreateAgentExecutionInput,
    ): Promise<CreateAgentExecutionResult> => {
      setIsCreating(true);
      setError(null);

      try {
        const hasConfig = input.modelName || input.interactionMode;
        const executionConfig = hasConfig
          ? {
              ...(input.modelName ? { modelName: input.modelName } : {}),
              ...(input.interactionMode
                ? { interactionMode: INTERACTION_MODE_MAP[input.interactionMode] ?? InteractionMode.UNSPECIFIED }
                : {}),
            }
          : undefined;

        const execution = await stigmer.agentExecution.create({
          name: `execution-${Date.now()}`,
          org: input.org,
          sessionId: input.sessionId,
          agentId: input.agentId,
          message: input.message,
          executionConfig,
          runtimeEnv: input.runtimeEnv,
          attachments: input.attachments,
        });

        return {
          executionId: execution.metadata!.id,
          sessionId: input.sessionId,
        };
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
