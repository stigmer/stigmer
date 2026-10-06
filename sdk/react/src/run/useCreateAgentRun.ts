"use client";

import { useCallback, useState } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import {
  mergeSessionContext,
  type AttachmentInput,
  type EnvVarInput,
  type McpServerUsageInput,
  type ResourceRef,
  type RunConfigInput,
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
 * path (maps to `AgentRunSpec.session_spec` in the proto).
 *
 * Carries the session shape — workspace, harness, execution target, MCP
 * servers, skills — alongside the first message, so starting a session
 * with a configured workspace is a single API call (stigmer/stigmer#249).
 *
 * `agentRef` names the agent the new conversation runs; the server pins
 * the version it names (the agent's current version when it names none).
 * Omit it for a conversation with the built-in assistant.
 */
export interface BootstrapSessionSpec {
  /** The agent the new conversation runs. Omit for the built-in assistant. */
  readonly agentRef?: ResourceRef;
  /** Initial conversation subject. Omit for an async LLM-generated title. */
  readonly subject?: string;
  /** Workspace source entries to attach to the session. */
  readonly workspaceEntries?: WorkspaceEntryInput[];
  /** MCP server configurations to include for tool access. */
  readonly mcpServerUsages?: McpServerUsageInput[];
  /** Skill references to enable for runs in this session. */
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
  /** Run harness. Immutable after the first run runs. */
  readonly harness?: HarnessOption;
  /** Where session activities execute. Immutable after the first run runs. */
  readonly executionTarget?: ExecutionTargetOption;
}

/** Fields shared by both variants of {@link CreateAgentRunInput}. */
export interface SharedAgentRunFields {
  /** Id of the organization that owns the session (a slug is also accepted). */
  readonly org: string;
  /** User message that initiates the run. */
  readonly message: string;
  /**
   * The model this message asks for. Omit it to run the model a less
   * specific layer chooses: the agent's run defaults when the conversation
   * runs the agent's engine, else the operator profile, else the engine's
   * own default. Maps to `RunConfig.model_name` on
   * `AgentRunSpec.run_config`.
   */
  readonly modelName?: string;
  /**
   * Execution-scoped secrets and configuration (Run Flow).
   *
   * Values are injected into the agent sandbox for this run only
   * and deleted when the run completes. They take the highest
   * merge priority, overriding every environment layer. Keys must be
   * declared in the agent's env declarations (a whitelist, not a value
   * source) or they are dropped.
   *
   * Use this for B2B integrations where per-call credentials are
   * injected at runtime, or for one-off secrets that should not persist.
   *
   * For persistent credentials that are reused across runs, use
   * the Environment Flow instead: the keys an agent declares are read
   * from the running person's personal environment.
   *
   * @see {@link https://stigmer.ai/docs/product/how-to-provide-secrets | How to Provide Secrets}
   */
  readonly runtimeEnv?: Record<string, EnvVarInput>;
  /**
   * Pre-uploaded file attachments injected into the agent sandbox.
   *
   * Each entry must include a `storageKey` obtained from
   * `agentRun.uploadAttachment()`. The agent can read attached
   * files from their mount paths (default `/inputs/{filename}`).
   */
  readonly attachments?: AttachmentInput[];
  /**
   * Interaction mode for this run.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   *
   * Maps to `AgentRunSpec.interaction_mode` in the proto.
   */
  readonly interactionMode?: "agent" | "plan";
  /**
   * Service tier this message asks for (stigmer/stigmer#357). Omit it to
   * keep the tier of the layer that chose the model (an agent's default
   * may turn fast on); set it to choose explicitly, with or without
   * {@link modelName} — alone it adjusts the model a less specific layer
   * chose.
   *
   * - `"standard"`: the model's base-priced configuration. Sent
   *   explicitly, it turns off a fast tier an agent default would apply.
   * - `"fast"`: the provider's fast variant at fast rates. Valid only for
   *   models whose registry entry prices a fast variant — the backend
   *   refuses the create otherwise, so gate the option on
   *   `ModelInfo.serviceTiers`.
   *
   * Maps to `RunConfig.service_tier` on `AgentRunSpec.run_config`.
   */
  readonly serviceTier?: ServiceTierOption;
  /**
   * Thinking mode this message asks for (stigmer/stigmer#772). Omit it to
   * keep the mode of the layer that chose the model; set it, with or
   * without {@link modelName}, to choose explicitly.
   *
   * - `"disabled"`: the model's base variant. Sent explicitly, it turns
   *   off thinking an agent default would apply. Refused for a model that
   *   always thinks (`ModelInfo.thinkingRequired`); leave the mode unset or
   *   send `"enabled"` for it.
   * - `"enabled"`: the model's extended-reasoning variant, billed at base
   *   per-token rates (reasoning tokens bill as output). Valid only for
   *   models whose registry entry, on the harness the run runs on,
   *   declares a thinking form — the backend refuses the create otherwise,
   *   so gate the option on `thinkingSelectable(model)`.
   *
   * Maps to `RunConfig.thinking_mode` on `AgentRunSpec.run_config`.
   */
  readonly thinkingMode?: ThinkingModeOption;
  /**
   * Marks this run as a Build-from-plan turn: the user approved a
   * plan from a prior Plan-mode run and asked the agent to implement
   * it. The runner injects the implement-plan directive (pointing at the
   * attached approved plan when present); the thread hides the turn's
   * machine-written message entirely — the plan card above it is the
   * visible cause. Surfaces without that treatment (the CLI, history)
   * show the message text as-is.
   *
   * Maps to `AgentRunSpec.build_from_plan` in the proto.
   */
  readonly buildFromPlan?: boolean;
  /**
   * Auto-approve every tool call for this run.
   *
   * When `true`, the human-in-the-loop approval gate is bypassed and no tool
   * waits for approval. When `false` (default), mutating/destructive tools
   * require approval per the configured policies. Maps to
   * `AgentRunSpec.auto_approve_all` in the proto.
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
   * Maps to `AgentRunSpec.structured_output_schema` in the proto.
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
   * ID of the run this one supersedes via edit-and-resubmit.
   *
   * Set when the user stopped an in-flight turn, edited its message, and
   * resubmitted. Chat threads hide the superseded run so the edited
   * message replaces the original in place; history surfaces keep the full
   * record. Maps to `AgentRunSpec.supersedes_run_id`.
   *
   * Display-level only — the runner does not rewind model context.
   */
  readonly supersedesRunId?: string;
}

/**
 * Input for {@link UseCreateAgentRunReturn.create}. Exactly one
 * session strategy must be provided:
 *
 * - **`sessionId`** — Create the run within an existing session.
 * - **`sessionSpec`** — One-call bootstrap: the server creates a session
 *   from the embedded spec and dispatches this run in it. The new
 *   session's ID is returned on {@link CreateAgentRunResult.sessionId}.
 *
 * The two map onto the execution's `target` oneof, which carries one;
 * providing both is a type error.
 */
export type CreateAgentRunInput = SharedAgentRunFields &
  (
    | {
        /** Session to create the run within. */
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

/** Resolved output of {@link UseCreateAgentRunReturn.create}. */
export interface CreateAgentRunResult {
  /** Server-assigned identifier for the newly created run. */
  readonly runId: string;
  /**
   * Session the run belongs to. On the `sessionId` path this echoes
   * the input; on the `sessionSpec` bootstrap path it is the server-created
   * session's ID.
   */
  readonly sessionId: string;
}

/** Return value of {@link useCreateAgentRun}. */
export interface UseCreateAgentRunReturn {
  /** Create a run within a session. Resolves with the new run ID. */
  readonly create: (
    input: CreateAgentRunInput,
  ) => Promise<CreateAgentRunResult>;
  /** `true` while the create RPC is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `agentRun.create()` with loading/error
 * state.
 *
 * Maps 1:1 to the AgentRun aggregate — a single run of an agent.
 * Two session strategies are supported, mirroring the RPC contract:
 * pass `sessionId` to execute within an existing session (use
 * {@link useCreateSession} to create one), or pass `sessionSpec` to
 * bootstrap a new session (workspace, harness, execution target) and
 * dispatch the first message in a single call.
 *
 * Supports both secret delivery flows:
 *
 * - **Environment Flow** — Secrets are stored in the running person's
 *   personal environment. No `runtimeEnv` needed; the backend reads
 *   every key the agent declares from there.
 * - **Run Flow** — Pass `runtimeEnv` to inject per-execution
 *   secrets. Values are merged with the highest priority and deleted
 *   when the run completes.
 *
 * @example
 * ```tsx
 * // Environment Flow: secrets come from the person's personal environment
 * const { create } = useCreateAgentRun();
 * await create({ org: "acme", sessionId: "ses_abc", message: "Review the PR" });
 * ```
 *
 * @example
 * ```tsx
 * // Run Flow: inject per-call secrets
 * const { create } = useCreateAgentRun();
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
 * const { create } = useCreateAgentRun();
 * const { sessionId } = await create({
 *   org: "acme",
 *   message: "Customize the landing page",
 *   sessionSpec: {
 *     agentRef: { org: "acme", slug: "site-builder" },
 *     workspaceEntries: [{ name: "site", source: { localPath: { path: "/repos/site" } } }],
 *     executionTarget: "local",
 *   },
 * });
 * ```
 */
export function useCreateAgentRun(): UseCreateAgentRunReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (
      input: CreateAgentRunInput,
    ): Promise<CreateAgentRunResult> => {
      setIsCreating(true);
      setError(null);

      try {
        // What this message asks for, and nothing it leaves to a less
        // specific layer: an absent field is "not set here", so the
        // agent's defaults and the operator profile still apply to it.
        const runConfig: RunConfigInput | undefined =
          input.modelName || input.serviceTier || input.thinkingMode
            ? {
                ...(input.modelName ? { modelName: input.modelName } : {}),
                ...(input.serviceTier
                  ? { serviceTier: toProtoServiceTier(input.serviceTier) }
                  : {}),
                ...(input.thinkingMode
                  ? { thinkingMode: toProtoThinkingMode(input.thinkingMode) }
                  : {}),
              }
            : undefined;

        const sessionSpec = input.sessionSpec
          ? {
              agentRef: input.sessionSpec.agentRef,
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

        const execution = await stigmer.agentRun.create({
          name: `run-${Date.now()}`,
          org: input.org,
          sessionId: input.sessionId,
          sessionSpec,
          message: input.message,
          runConfig,
          interactionMode: input.interactionMode
            ? toProtoInteractionMode(input.interactionMode)
            : undefined,
          buildFromPlan: input.buildFromPlan || undefined,
          structuredOutputSchema: input.structuredOutputSchema,
          autoApproveAll: input.autoApproveAll,
          runtimeEnv: input.runtimeEnv,
          attachments: input.attachments,
          workspaceFileRefs: input.workspaceFileRefs,
          supersedesRunId: input.supersedesRunId,
        });

        // On the bootstrap path the server assigns the session and points
        // the execution's target at it; trust the response first so both
        // variants report the real session.
        const target = execution.spec?.target;
        return {
          runId: execution.metadata!.id,
          sessionId:
            target?.case === "sessionId" ? target.value : (input.sessionId ?? ""),
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
