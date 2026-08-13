"use client";

import { useCallback, useEffect, useState } from "react";
import { getUserMessage, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import type { AgentResolution } from "../agent/index.js";
import { useDefaultAgent } from "../agent/index.js";
import { useModelRegistry } from "../models/index.js";
import { parseModelKey } from "../models/registry.js";
import { DEFAULT_HARNESS, type HarnessOption } from "../models/harness.js";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace/index.js";
import { useSessionVariables, type UseSessionVariablesReturn } from "../execution/useSessionVariables.js";
import type { SessionComposerSubmitContext } from "../composer/index.js";
import { useStigmer } from "../hooks.js";
import { withTimeout } from "../internal/withTimeout.js";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution.js";
import type { ExecutionTargetOption } from "./execution-target.js";
import { useExecutionTarget } from "../execution-target-context.js";
import { useApprovalDefaults } from "../approval-defaults-context.js";
import { useRunnerAdapter } from "../runner-adapter.js";
import { resolveExecutionRuntimeEnv, type RuntimeEnvProvider } from "./runtime-env.js";
import type { SessionAudience } from "./audience.js";
import { assertValidRunConfig, type SessionRunConfig } from "./run-config.js";

const DEFAULT_AGENT_TIMEOUT_MS = 10_000;

const STORAGE_KEY_HARNESS = "stigmer:session:harness";

/**
 * Platform policy for guest (share/embed) sessions: the cursor harness with
 * the Auto model (an omitted modelName resolves to cursor's "default"/Auto in
 * the runner).
 *
 * This lives CLIENT-side deliberately — it is the only layer that can. The
 * SDK's guest audience covers both public visitors (guest tokens) and org
 * members chatting via an org-audience share (their own member tokens, which
 * carry no share linkage in Phase A) — the server cannot distinguish the
 * latter from ordinary Console traffic, so share-surface policy must be
 * applied where the surface is known. Server-side guest-token gates own the
 * abuse controls (rate limits, bounded execution profile).
 */
const GUEST_HARNESS: HarnessOption = "cursor";

function modelStorageKey(harness: HarnessOption): string {
  return harness === "cursor"
    ? "stigmer:session:model:cursor"
    : "stigmer:session:model";
}

/** Options for {@link useNewSessionFlow}. */
export interface UseNewSessionFlowOptions {
  /** Organization slug. Required for session and execution creation. */
  readonly org: string;
  /**
   * Called after a session and its first execution are created successfully.
   * The consumer is responsible for navigation (e.g. `router.push`).
   */
  readonly onSessionCreated: (sessionId: string) => void;
  /**
   * Called when an error occurs during session creation.
   * The consumer can use this for toast notifications or other UI feedback.
   * If not provided, errors are still available via {@link UseNewSessionFlowReturn.submitError}.
   */
  readonly onError?: (message: string) => void;
  /**
   * Where session activities should execute.
   *
   * @deprecated Prefer setting `executionTarget` on `StigmerProvider`
   * instead. The provider-level value is inherited by all hooks in the
   * tree automatically. This per-hook option is honored as an override
   * for backward compatibility but will be removed in a future major.
   *
   * When omitted, the hook reads from `StigmerProvider`'s
   * `executionTarget` prop via context. If that is also unset, the
   * server decides based on deployment context.
   */
  readonly executionTarget?: ExecutionTargetOption;
  /**
   * Supplies host-app environment variables for the session's first
   * execution. Evaluated once per submission, at submit time, so
   * short-lived credentials stay fresh; evaluated **before** the session
   * is created so a credential failure never strands an empty session.
   *
   * Host values win over composer-collected env on key collisions. If
   * the provider throws, the submission fails and the error surfaces
   * via {@link UseNewSessionFlowReturn.submitError} / {@link onError}.
   * See {@link RuntimeEnvProvider}.
   */
  readonly getRuntimeEnv?: RuntimeEnvProvider;
  /**
   * Harness pre-selected for new sessions when the user has not made an
   * explicit choice yet (e.g. an embedder whose agents primarily run
   * coding tasks defaults to `"cursor"`).
   *
   * Read once on mount. The user's own selection — persisted to
   * localStorage on explicit change — always takes precedence on
   * subsequent visits.
   *
   * Ignored for the `"guest"` audience: guest sessions always run the
   * platform's share-surface policy (cursor harness, Auto model), never an
   * embedder preference or a stored Console choice.
   *
   * @default DEFAULT_HARNESS ("native")
   */
  readonly defaultHarness?: HarnessOption;
  /**
   * Who this flow serves. `"guest"` adapts the orchestration to the
   * guest principal's permission model: the org default-agent lookup
   * (which a guest token cannot read) is skipped, and submission
   * requires an explicit agent resolution instead of falling back to
   * the org's default agent — a shared-agent page must never run
   * anything but the pinned shared agent. See {@link SessionAudience}.
   *
   * @default "integrator"
   */
  readonly audience?: SessionAudience;
  /**
   * Custom key-value pairs stored on the created session's
   * `SessionSpec.metadata`.
   *
   * A passthrough for embedder-owned keys (correlation IDs, tenant tags)
   * and for platform-reserved `stigmer.ai/*` keys set explicitly. For the
   * common case — standing user context injected into the agent's prompt —
   * prefer the typed {@link sessionContext} option, which maps onto the
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
  /**
   * Owner-pinned model/tier for the session's first execution
   * (stigmer/stigmer#664). Stamped at submit, winning over the
   * composer's selection and the restored Console preference. Pair
   * with the same pin on the conversation surface
   * (`useSessionPageFlow` / `SessionViewer`) so follow-ups match.
   * Ignored for the `"guest"` audience (the platform share policy owns
   * guest execution config). See {@link SessionRunConfig}.
   */
  readonly runConfig?: SessionRunConfig;
}

/** Return value of {@link useNewSessionFlow}. */
export interface UseNewSessionFlowReturn {
  /** Currently selected harness (persisted to localStorage). */
  readonly harness: HarnessOption;
  /** Switch the harness. Resets the model if invalid for the new harness. */
  readonly setHarness: (harness: HarnessOption) => void;

  /** Currently selected model ID (persisted per-harness to localStorage). */
  readonly modelId: string | undefined;
  /** Update the selected model. Automatically persists to localStorage. */
  readonly setModelId: (id: string) => void;

  /** Currently selected agent reference, or `null` for the default agent. */
  readonly agentRef: ResourceRef | null;
  /** Update the selected agent reference. */
  readonly setAgentRef: (ref: ResourceRef | null) => void;

  /** Current agent resolution state (saved instance vs direct reference). */
  readonly resolution: AgentResolution | null;
  /** Update the agent resolution. */
  readonly setResolution: (r: AgentResolution | null) => void;

  /** Active MCP server configurations. */
  readonly mcpServerUsages: McpServerUsageInput[];
  /** Update MCP server configurations. */
  readonly setMcpServerUsages: (usages: McpServerUsageInput[]) => void;

  /** Active skill references. */
  readonly skillRefs: ResourceRef[];
  /** Update skill references. */
  readonly setSkillRefs: (refs: ResourceRef[]) => void;

  /** Workspace entries manager (git repos and local paths). */
  readonly workspace: UseWorkspaceEntriesReturn;
  /** Session variables (per-execution secrets) manager. */
  readonly sessionVariables: UseSessionVariablesReturn;

  /** `true` while the create session + execution flow is in flight. */
  readonly isSubmitting: boolean;
  /** Human-readable error from the last failed submission, or `null`. */
  readonly submitError: string | null;

  /**
   * Create a session with the first execution.
   *
   * Composes all managed state (agent, workspace, MCP servers, skills,
   * model, session variables) into a single bootstrap RPC —
   * `agentExecution.create` with an embedded session spec — then calls
   * `onSessionCreated` on success.
   *
   * The `model` parameter overrides `modelId` for this submission only
   * (used when SessionComposer passes a per-message model selection).
   */
  readonly submit: (
    message: string,
    model?: string,
    context?: SessionComposerSubmitContext,
  ) => Promise<void>;
}

/**
 * Orchestrates the "create a new session" flow.
 *
 * Manages all the state required to configure and submit a new session:
 * model selection (with localStorage persistence), agent resolution,
 * MCP server/skill selection, workspace entries, and session
 * variables. On submission, creates the session and its first execution
 * with a single one-call bootstrap RPC (`agentExecution.create` with an
 * embedded session spec), then notifies the consumer via
 * `onSessionCreated`.
 *
 * This hook is framework-agnostic — it works identically in Next.js,
 * Vite, Tauri, or any React environment. Navigation, toast notifications,
 * and draft-mode logic are the consumer's responsibility.
 *
 * @example
 * ```tsx
 * const flow = useNewSessionFlow({
 *   org: "acme",
 *   onSessionCreated: (id) => navigate(`/sessions/${id}`),
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <SessionComposer
 *   onSubmit={flow.submit}
 *   isSubmitting={flow.isSubmitting}
 *   org="acme"
 *   workspace={flow.workspace}
 *   agentRef={flow.agentRef}
 *   onAgentRefChange={flow.setAgentRef}
 *   onAgentResolutionChange={flow.setResolution}
 *   mcpServerUsages={flow.mcpServerUsages}
 *   onMcpServerUsagesChange={flow.setMcpServerUsages}
 *   skillRefs={flow.skillRefs}
 *   onSkillRefsChange={flow.setSkillRefs}
   *   sessionVariables={flow.sessionVariables}
 *   defaultModelId={flow.modelId}
 *   onModelChange={flow.setModelId}
 * />
 * ```
 */
export function useNewSessionFlow(
  options: UseNewSessionFlowOptions,
): UseNewSessionFlowReturn {
  const {
    org,
    onSessionCreated,
    onError,
    getRuntimeEnv,
    defaultHarness,
    metadata,
    sessionContext,
  } = options;
  const isGuest = options.audience === "guest";
  // Guests never carry a client pin: guest execution config is owned by
  // the server-side share policy (GUEST_HARNESS reasoning). Validated at
  // render so a statically-wrong pin (fast tier, no model) fails in the
  // embedder's dev loop, not as the end user's failed send.
  const runConfig = isGuest ? undefined : options.runConfig;
  if (runConfig) assertValidRunConfig(runConfig);
  const pinnedModelName = runConfig?.modelName;
  const pinnedServiceTier = runConfig?.serviceTier;
  const contextTarget = useExecutionTarget();
  const executionTarget = options.executionTarget ?? contextTarget;
  const adapter = useRunnerAdapter();
  // Host approval default (#302): pre-arm auto_approve_all on the bootstrap
  // create when the provider says so. Guests never inherit it — a share-link
  // visitor is not the operator the host's trust judgment covers (the
  // GUEST_HARNESS fixed-platform-policy reasoning).
  const approvalDefaults = useApprovalDefaults();
  const autoApproveAll =
    (!isGuest && approvalDefaults?.autoApproveAll) || undefined;

  const [harness, setHarnessRaw] = useState<HarnessOption>(() => {
    // Guests get the fixed platform policy (see GUEST_HARNESS) and never
    // touch localStorage: a browser previously used in the Console must not
    // leak its stored harness into a share/embed session.
    if (isGuest) return GUEST_HARNESS;
    if (typeof window === "undefined") return defaultHarness ?? DEFAULT_HARNESS;
    // Only explicit user choices are persisted (see setHarness), so a
    // stored value always outranks the embedder's defaultHarness.
    const stored = localStorage.getItem(STORAGE_KEY_HARNESS);
    if (stored === "native" || stored === "cursor") return stored;
    return defaultHarness ?? DEFAULT_HARNESS;
  });

  const stigmer = useStigmer();
  const { getModel, isLoading: isModelsLoading } = useModelRegistry({ harness });
  const { create: createExecution } = useCreateAgentExecution();
  // Guests cannot read the org default agent (and must never run it) —
  // `null` puts the hook in its stable no-op mode, and the submit path
  // below fails closed instead of falling back.
  const {
    agent: defaultAgent,
    isLoading: isDefaultAgentLoading,
    error: defaultAgentError,
    waitForResolution: waitForDefaultAgent,
  } = useDefaultAgent(isGuest ? null : org);
  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();

  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;

  const setHarness = useCallback(
    (h: HarnessOption) => {
      setHarnessRaw(h);
      // Guests have no harness picker; if a caller invokes this anyway, the
      // guest surface must never write into the Console's preference keys.
      if (isGuest) return;
      // Persist only explicit choices — never the seeded value — so the
      // embedder's defaultHarness keeps applying until the user decides.
      localStorage.setItem(STORAGE_KEY_HARNESS, h);
      const storedModel = localStorage.getItem(modelStorageKey(h));
      const plain = storedModel ? (parseModelKey(storedModel)?.modelId ?? storedModel) : undefined;
      setModelId(plain);
    },
    [isGuest],
  );

  // Restore persisted model — only after the registry has loaded so
  // getModel can actually validate the stored ID against live data.
  // Guests skip the restore: modelId stays undefined, the create omits
  // modelName, and the cursor harness resolves it to Auto — a Console-used
  // browser must not leak its stored model into a share/embed session.
  useEffect(() => {
    if (isGuest || isModelsLoading) return;
    const stored = localStorage.getItem(modelStorageKey(harness));
    if (stored) {
      const plain = parseModelKey(stored)?.modelId ?? stored;
      if (getModel(plain)) {
        setModelId(plain);
      }
    }
  }, [getModel, harness, isGuest, isModelsLoading]);

  // Persist model on change (using current harness key).
  // Strip compound keys (e.g. "cursor/default") to plain modelId before storing.
  // Guests never persist — the symmetric half of the isolation above.
  useEffect(() => {
    if (isGuest) return;
    if (modelId) {
      const plain = parseModelKey(modelId)?.modelId ?? modelId;
      localStorage.setItem(modelStorageKey(harness), plain);
    }
  }, [modelId, harness, isGuest]);

  const submit = useCallback(
    async (
      message: string,
      selectedModel?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      if (isSubmitting) return;
      if (!org) {
        const msg = "Select an organization before starting a session.";
        setSubmitError(msg);
        onError?.(msg);
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Host env is evaluated per submission (short-lived credentials)
        // and before session creation, so a credential failure can never
        // strand an empty session. Without a provider the composer env
        // passes through untouched — no extra await on the hot path.
        const runtimeEnv = getRuntimeEnv
          ? await resolveExecutionRuntimeEnv(getRuntimeEnv, context?.runtimeEnv)
          : context?.runtimeEnv;

        const sessionSpecBase = {
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
          // The typed-wins merge happens downstream in useCreateAgentExecution;
          // both fields are forwarded verbatim here.
          metadata,
          sessionContext,
          harness,
          executionTarget,
        };

        const executionFields = {
          org,
          message,
          // The owner pin wins over the composer and the restored
          // preference (#664); the pinned tier is stamped only as
          // "fast" — standard stays off the wire, preserving the #357
          // UNSPECIFIED-vs-explicit telemetry distinction.
          modelName: pinnedModelName ?? selectedModel ?? validModelId,
          runtimeEnv,
          attachments: context?.attachments,
          interactionMode: context?.interactionMode,
          serviceTier: pinnedModelName
            ? (pinnedServiceTier === "fast" ? "fast" : undefined)
            : context?.serviceTier,
          workspaceFileRefs: context?.workspaceFileRefs,
          autoApproveAll,
        };

        // Resolve which agent the bootstrapped session runs against: an
        // explicit instance when one is known, otherwise an agent ID the
        // server resolves to its default instance (creating it if missing).
        let agentInstanceId: string | undefined;
        let agentId: string | undefined;

        if (agentRef && resolution) {
          if (resolution.mode === "saved") {
            agentInstanceId = resolution.instanceId;
          } else {
            // Slug reference → agent ID; the server handles instance
            // resolution, including auto-creating a missing default
            // instance (which a client-side lookup cannot).
            const agent = await stigmer.agent.getByReference(agentRef);
            agentId = agent.metadata!.id;
          }
        } else if (isGuest) {
          // Fail closed: a guest session is only ever created against the
          // pinned shared agent's resolution. Reaching here means the pin
          // has not been applied yet (or was cleared) — never substitute
          // the org default agent for an anonymous visitor.
          throw new Error(
            "This agent is still loading. Please try again in a moment.",
          );
        } else {
          let resolvedInstanceId = defaultAgent?.status?.defaultInstanceId;
          if (!resolvedInstanceId) {
            if (isDefaultAgentLoading) {
              const resolved = await withTimeout(
                waitForDefaultAgent(),
                DEFAULT_AGENT_TIMEOUT_MS,
                "Default agent did not load in time. Please try again.",
              );
              resolvedInstanceId = resolved?.status?.defaultInstanceId;
            } else if (defaultAgentError) {
              throw new Error(
                "Failed to load default agent. Please try again.",
              );
            }
            if (!resolvedInstanceId) {
              throw new Error(
                "No default agent available. Select an agent to start a session.",
              );
            }
          }
          agentInstanceId = resolvedInstanceId;
        }

        // One-call bootstrap: the embedded session spec and the first
        // message travel in a single create — the server creates the
        // session and dispatches the execution atomically.
        const { sessionId } = await createExecution({
          ...executionFields,
          agentId,
          sessionSpec: { ...sessionSpecBase, agentInstanceId },
        });

        // Local execution: attach the session's runner worker now that the
        // session ID is known. The session view (useSessionConversation)
        // owns the steady-state lifecycle, but it is not mounted yet —
        // navigation happens after onSessionCreated below. Attaching after
        // the create is safe: the first activity waits on the session's
        // task queue for a worker (5-minute ScheduleToStart window), so the
        // worker attached here picks it up immediately.
        if (adapter && executionTarget === "local") {
          await adapter.onSessionOpened(sessionId);
        }

        sessionVariables.clear();
        onSessionCreated(sessionId);
      } catch (err) {
        const detail = getUserMessage(err, "Failed to start session");
        setSubmitError(detail);
        onError?.(detail);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      org,
      isGuest,
      harness,
      executionTarget,
      autoApproveAll,
      adapter,
      getRuntimeEnv,
      validModelId,
      pinnedModelName,
      pinnedServiceTier,
      workspace,
      mcpServerUsages,
      skillRefs,
      metadata,
      sessionContext,
      agentRef,
      resolution,
      defaultAgent,
      isDefaultAgentLoading,
      defaultAgentError,
      waitForDefaultAgent,
      stigmer.agent,
      createExecution,
      sessionVariables,
      onSessionCreated,
      onError,
    ],
  );

  return {
    harness,
    setHarness,
    modelId: validModelId,
    setModelId,
    agentRef,
    setAgentRef,
    resolution,
    setResolution,
    mcpServerUsages,
    setMcpServerUsages,
    skillRefs,
    setSkillRefs,
    workspace,
    sessionVariables,
    isSubmitting,
    submitError,
    submit,
  };
}
