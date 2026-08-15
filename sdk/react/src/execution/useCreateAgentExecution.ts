"use client";

import { useCallback, useState } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import {
  mergeSessionContext,
  type AttachmentInput,
  type EnvVarInput,
  type McpServerUsageInput,
  type ResourceRef,
  type WorkspaceEntryInput,
} from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { toProtoInteractionMode } from "../composer/interaction-mode.js";
import { toProtoServiceTier, type ServiceTierOption } from "../models/service-tier.js";
import { toProtoThinkingMode, type ThinkingModeOption } from "../models/thinking-mode.js";
import { toProtoHarness, type HarnessOption } from "../models/harness.js";
import {
  toProtoExecutionTarget,
  type ExecutionTargetOption,
} from "../session/execution-target.js";

/**
 * Spec for the session the server auto-creates on the one-call bootstrap
 * path (maps to `AgentExecutionSpec.session_spec` in the proto).
 *
 * Carries the session shape — workspace, harness, execution target, MCP
 * servers, skills — alongside the first message, so starting a session
 * with a configured workspace is a single API call (stigmer/stigmer#249).
 *
 * When `agentInstanceId` is omitted, the server resolves the agent's
 * default instance from the execution's `agentId` (creating the instance
 * if missing), or falls back to the platform default agent.
 */
export interface BootstrapSessionSpec {
  /** Agent instance the session runs against. Omit to let the server resolve it. */
  readonly agentInstanceId?: string;
  /** Initial conversation subject. Omit for an async LLM-generated title. */
  readonly subject?: string;
  /** Workspace source entries to attach to the session. */
  readonly workspaceEntries?: WorkspaceEntryInput[];
  /** MCP server configurations to include for tool access. */
  readonly mcpServerUsages?: McpServerUsageInput[];
  /** Skill references to enable for executions in this session. */
  readonly skillRefs?: ResourceRef[];
  /**
   * Custom key-value pairs stored on the created session's
   * `SessionSpec.metadata`.
   *
   * A passthrough for embedder-owned keys (correlation IDs, tenant tags)
   * and for platform-reserved `stigmer.ai/*` keys set explicitly. For the
   * common case — standing user context injected into the agent's prompt —
   * prefer the typed {@link sessionContext} field, which maps onto the
   * reserved `stigmer.ai/session-context` key and wins over a raw entry
   * under that key when both are provided.
   */
  readonly metadata?: Record<string, string>;
  /**
   * Standing, per-user context the agent receives on every turn but the
   * conversation UI never renders — who the caller is, their experience
   * level, their standing instructions (stigmer/stigmer#286).
   *
   * Stored on the created session's `SessionSpec.metadata` under
   * `stigmer.ai/session-context`; the agent runner injects it into the
   * system prompt as already-known background, so agents can greet the
   * user by name and calibrate depth/defaults from the first turn without
   * a visible context preamble.
   *
   * Personalization, not authorization: anyone who can create the session
   * can set this (the same trust level as authoring the first message).
   * Hidden from the conversation thread, not from the API — `session.get`
   * returns it, so never put secrets here; secrets belong in `runtimeEnv`
   * or Environment resources. Large values bloat every prompt.
   */
  readonly sessionContext?: string;
  /** Execution harness. Immutable after the first execution runs. */
  readonly harness?: HarnessOption;
  /** Where session activities execute. Immutable after the first execution runs. */
  readonly executionTarget?: ExecutionTargetOption;
}

/** Fields shared by both variants of {@link CreateAgentExecutionInput}. */
export interface SharedAgentExecutionFields {
  /** Organization slug that owns the session. */
  readonly org: string;
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
   * merge priority, overriding Environment values bound via the
   * instance. Keys must be declared in the agent's env declarations
   * (a whitelist, not a value source) or they are dropped.
   *
   * Use this for B2B integrations where per-call credentials are
   * injected at runtime, or for one-off secrets that should not persist.
   *
   * For persistent credentials that are reused across executions, use
   * the Environment Flow instead (store secrets in an Environment
   * resource and bind them via an AgentInstance).
   *
   * @see {@link https://stigmer.ai/docs/product/how-to-provide-secrets | How to Provide Secrets}
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
   * Service tier for this execution's model calls (stigmer/stigmer#357).
   *
   * - `"standard"` (default): the model's base-priced configuration,
   *   requested explicitly — never the provider account default.
   * - `"fast"`: the provider's fast variant at fast rates. Valid only for
   *   models whose registry entry prices a fast variant — the backend
   *   refuses the create otherwise, so gate the option on
   *   `ModelInfo.serviceTiers`.
   *
   * Maps to `ExecutionConfig.service_tier` in the proto.
   */
  readonly serviceTier?: ServiceTierOption;
  /**
   * Thinking mode for this execution's model calls (stigmer/stigmer#772).
   *
   * - `"disabled"` (default): the model's base variant, pinned explicitly —
   *   never the provider account default.
   * - `"enabled"`: the model's extended-reasoning variant, billed at base
   *   per-token rates (reasoning tokens bill as output). Valid only for
   *   cursor-harness models whose registry entry declares the thinking
   *   capability — the backend refuses the create otherwise, so gate the
   *   option on `ModelInfo.thinkingCapable`.
   *
   * Maps to `ExecutionConfig.thinking_mode` in the proto.
   */
  readonly thinkingMode?: ThinkingModeOption;
  /**
   * Marks this execution as a Build-from-plan turn: the user approved a
   * plan from a prior Plan-mode execution and asked the agent to implement
   * it. The runner injects the implement-plan directive (pointing at the
   * attached approved plan when present); the thread hides the turn's
   * machine-written message entirely — the plan card above it is the
   * visible cause. Surfaces without that treatment (the CLI, history)
   * show the message text as-is.
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
  /**
   * ID of the execution this one supersedes via edit-and-resubmit.
   *
   * Set when the user stopped an in-flight turn, edited its message, and
   * resubmitted. Chat threads hide the superseded execution so the edited
   * message replaces the original in place; history surfaces keep the full
   * record. Maps to `AgentExecutionSpec.supersedes_execution_id`.
   *
   * Display-level only — the runner does not rewind model context.
   */
  readonly supersedesExecutionId?: string;
}

/**
 * Input for {@link UseCreateAgentExecutionReturn.create}. Exactly one
 * session strategy must be provided:
 *
 * - **`sessionId`** — Create the execution within an existing session.
 * - **`sessionSpec`** — One-call bootstrap: the server creates a session
 *   from the embedded spec and dispatches this execution in it. The new
 *   session's ID is returned on {@link CreateAgentExecutionResult.sessionId}.
 *
 * Providing both is a type error (and an `INVALID_ARGUMENT` server-side).
 */
export type CreateAgentExecutionInput = SharedAgentExecutionFields &
  (
    | {
        /** Session to create the execution within. */
        readonly sessionId: string;
        /** @internal Discriminant — excluded when `sessionId` is provided. */
        readonly sessionSpec?: never;
      }
    | {
        /** Spec for the session to auto-create (one-call bootstrap). */
        readonly sessionSpec: BootstrapSessionSpec;
        /** @internal Discriminant — excluded when `sessionSpec` is provided. */
        readonly sessionId?: never;
      }
  );

/** Resolved output of {@link UseCreateAgentExecutionReturn.create}. */
export interface CreateAgentExecutionResult {
  /** Server-assigned identifier for the newly created execution. */
  readonly executionId: string;
  /**
   * Session the execution belongs to. On the `sessionId` path this echoes
   * the input; on the `sessionSpec` bootstrap path it is the server-created
   * session's ID.
   */
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
 * Maps 1:1 to the AgentExecution aggregate — a single run of an agent.
 * Two session strategies are supported, mirroring the RPC contract:
 * pass `sessionId` to execute within an existing session (use
 * {@link useCreateSession} to create one), or pass `sessionSpec` to
 * bootstrap a new session (workspace, harness, execution target) and
 * dispatch the first message in a single call.
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
 *
 * @example
 * ```tsx
 * // One-call bootstrap: session with a workspace + first message
 * const { create } = useCreateAgentExecution();
 * const { sessionId } = await create({
 *   org: "acme",
 *   message: "Customize the landing page",
 *   sessionSpec: {
 *     agentInstanceId: "ain_abc",
 *     workspaceEntries: [{ name: "site", source: { localPath: { path: "/repos/site" } } }],
 *     executionTarget: "local",
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
          input.serviceTier ||
          input.thinkingMode ||
          input.structuredOutputSchema ||
          input.buildFromPlan;
        const executionConfig = hasConfig
          ? {
              ...(input.modelName ? { modelName: input.modelName } : {}),
              ...(input.interactionMode
                ? { interactionMode: toProtoInteractionMode(input.interactionMode) }
                : {}),
              ...(input.serviceTier
                ? { serviceTier: toProtoServiceTier(input.serviceTier) }
                : {}),
              ...(input.thinkingMode
                ? { thinkingMode: toProtoThinkingMode(input.thinkingMode) }
                : {}),
              ...(input.structuredOutputSchema
                ? { structuredOutputSchema: input.structuredOutputSchema }
                : {}),
              ...(input.buildFromPlan ? { buildFromPlan: true } : {}),
            }
          : undefined;

        const sessionSpec = input.sessionSpec
          ? {
              agentInstanceId: input.sessionSpec.agentInstanceId,
              subject: input.sessionSpec.subject,
              workspaceEntries: input.sessionSpec.workspaceEntries,
              mcpServerUsages: input.sessionSpec.mcpServerUsages,
              skillRefs: input.sessionSpec.skillRefs,
              metadata: mergeSessionContext(
                input.sessionSpec.metadata,
                input.sessionSpec.sessionContext,
              ),
              harness: input.sessionSpec.harness
                ? toProtoHarness(input.sessionSpec.harness)
                : undefined,
              executionTarget: input.sessionSpec.executionTarget
                ? toProtoExecutionTarget(input.sessionSpec.executionTarget)
                : undefined,
            }
          : undefined;

        const execution = await stigmer.agentExecution.create({
          name: `execution-${Date.now()}`,
          org: input.org,
          sessionId: input.sessionId,
          sessionSpec,
          agentId: input.agentId,
          message: input.message,
          executionConfig,
          autoApproveAll: input.autoApproveAll,
          runtimeEnv: input.runtimeEnv,
          attachments: input.attachments,
          workspaceFileRefs: input.workspaceFileRefs,
          supersedesExecutionId: input.supersedesExecutionId,
        });

        return {
          executionId: execution.metadata!.id,
          // On the bootstrap path the server assigns the session; trust the
          // response first so both variants report the real session.
          sessionId: execution.spec?.sessionId ?? input.sessionId ?? "",
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
