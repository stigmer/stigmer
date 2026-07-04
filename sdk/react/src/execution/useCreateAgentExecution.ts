"use client";

import { useCallback, useState } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { AttachmentInput, EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { toProtoInteractionMode } from "../composer/interaction-mode.js";

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
  /**
   * Marks this execution as a "Build from plan" turn: the user approved a
   * plan from a prior Plan-mode execution and asked the agent to implement
   * it. The runner injects the implement-plan directive (pointing at the
   * attached approved plan when present); the thread renders the turn as a
   * compact chip instead of the raw message text.
   *
   * Maps to `ExecutionConfig.build_from_plan` in the proto.
   */
  readonly buildFromPlan?: boolean;
  /**
   * Auto-approve every tool call for this execution.
   *
   * When `true`, the human-in-the-loop approval gate is bypassed and no tool
   * waits for approval. When `false` (default), mutating/destructive tools
   * require approval per the configured policies. Maps to
   * `AgentExecutionSpec.auto_approve_all` in the proto.
   */
  readonly autoApproveAll?: boolean;
  /**
   * JSON Schema that the agent's final output must conform to.
   *
   * When set, the runner enforces structured output:
   * - Native harness: ToolStrategy adds an extract tool; agent must call it
   * - Cursor harness: prompt injection + 3-tier extraction fallback
   *
   * The validated data is returned in `execution.status.structuredOutput`.
   */
  readonly structuredOutputSchema?: JsonObject;
  /**
   * Workspace-relative file paths the user wants the agent to focus on.
   *
   * These are lightweight "attention" signals — the agent reads the files
   * directly from the workspace filesystem. No upload, no injection.
   * Populated by the drag-to-reference feature in SessionComposer.
   */
  readonly workspaceFileRefs?: string[];
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
        const hasConfig =
          input.modelName ||
          input.interactionMode ||
          input.structuredOutputSchema ||
          input.buildFromPlan;
        const executionConfig = hasConfig
          ? {
              ...(input.modelName ? { modelName: input.modelName } : {}),
              ...(input.interactionMode
                ? { interactionMode: toProtoInteractionMode(input.interactionMode) }
                : {}),
              ...(input.structuredOutputSchema
                ? { structuredOutputSchema: input.structuredOutputSchema }
                : {}),
              ...(input.buildFromPlan ? { buildFromPlan: true } : {}),
            }
          : undefined;

        const execution = await stigmer.agentExecution.create({
          name: `execution-${Date.now()}`,
          org: input.org,
          sessionId: input.sessionId,
          agentId: input.agentId,
          message: input.message,
          executionConfig,
          autoApproveAll: input.autoApproveAll,
          runtimeEnv: input.runtimeEnv,
          attachments: input.attachments,
          workspaceFileRefs: input.workspaceFileRefs,
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
