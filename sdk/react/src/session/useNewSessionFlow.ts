"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUserMessage, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import type { AccountExecutionDefaults } from "../identity-account/useAccountExecutionDefaults.js";
import type { AgentResolution } from "../agent/index.js";
import { useModelRegistry } from "../models/index.js";
import { parseModelKey } from "../models/registry.js";
import { DEFAULT_HARNESS, type HarnessOption } from "../models/harness.js";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace/index.js";
import { useSessionVariables, type UseSessionVariablesReturn } from "../run/useSessionVariables.js";
import type { SessionComposerSubmitContext } from "../composer/index.js";
import { useCreateRun } from "../run/useCreateRun.js";
import type { ExecutionTargetOption } from "./execution-target.js";
import { useExecutionTarget } from "../execution-target-context.js";
import { useApprovalDefaults } from "../approval-defaults-context.js";
import { useRunnerAdapter } from "../runner-adapter.js";
import { resolveRunRuntimeEnv, type RuntimeEnvProvider } from "./runtime-env.js";
import type { SessionAudience } from "./audience.js";
import { assertValidRunConfig, type SessionRunConfig } from "./run-config.js";
import {
  agentHarnessOf,
  agentRunDefaultsFor,
  type AgentRunDefaults,
} from "../agent/run-defaults.js";
import { useRunAgentSpec } from "../agent/useRunAgentSpec.js";

const STORAGE_KEY_HARNESS = "stigmer:session:harness";

/**
 * Platform policy for guest (share/embed) sessions: the cursor harness with
 * the Auto model (an omitted modelName resolves to cursor's "default"/Auto in
 * the runner).
 *
 * This lives CLIENT-side deliberately — it is the only layer that can. The
 * SDK's guest audience covers both public visitors (guest tokens) and org
 * members chatting via an org-audience share (their own member tokens, which
 * carry no share linkage) — the server cannot distinguish the
 * latter from ordinary Console traffic, so share-surface policy must be
 * applied where the surface is known. Server-side guest-token gates own the
 * abuse controls (rate limits, bounded run profile).
 */
const GUEST_HARNESS: HarnessOption = "cursor";

function modelStorageKey(harness: HarnessOption): string {
  return harness === "cursor"
    ? "stigmer:session:model:cursor"
    : "stigmer:session:model";
}

/** Options for {@link useNewSessionFlow}. */
export interface UseNewSessionFlowOptions {
  /** Organization id (a slug is also accepted). Required for session and run creation. */
  readonly org: string;
  /**
   * Called after a session and its first run are created successfully.
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
   * run. Evaluated once per submission, at submit time, so
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
   * The user's account-level execution defaults
   * (`IdentityAccountPreferences.default_*`), typically from
   * `useAccountExecutionDefaults()`. A SEED in the layered precedence —
   * explicit device-local choices always outrank it:
   *
   * - harness: the person's pick on this surface > the selected agent's
   *   engine (`AgentSpec.harness`) > stored choice >
   *   `accountDefaults.harness` > {@link defaultHarness} > platform
   *   default. May arrive after mount (whoAmI resolves async); a late
   *   value still seeds unless the user has already picked a harness
   *   this mount.
   * - model: where the selected agent names a model for the active
   *   engine, nothing unless the person picks one on this surface (the
   *   agent's default applies server-side); elsewhere the stored
   *   per-harness choice > the account's model for the active harness
   *   (validated against the registry; a stale model silently falls
   *   through) > the harness default.
   * - autoApprove: explicit in-session flip > the account's
   *   `default_auto_approve` > the host's `approvalDefaults` (derived,
   *   so a late-arriving value applies without a touched-ref effect).
   *
   * Seeded values are never persisted to localStorage — the account
   * preference keeps applying until the user decides. Ignored for the
   * `"guest"` audience (platform share policy owns guest config), and
   * consumers must not fetch identity for guest/embed surfaces.
   */
  readonly accountDefaults?: AccountExecutionDefaults;
  /**
   * Who this flow serves. `"guest"` adapts the orchestration to the
   * guest principal's permission model: submission requires an explicit
   * agent resolution instead of falling back to the built-in assistant
   * — a shared-agent page must never run anything but the pinned shared
   * agent. See {@link SessionAudience}.
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
   * Owner-pinned model/tier for the session's first run
   * (stigmer/stigmer#664). Stamped at submit, winning over the
   * composer's selection and the restored Console preference. Pair
   * with the same pin on the conversation surface
   * (`useSessionPageFlow` / `SessionViewer`) so follow-ups match.
   * Ignored for the `"guest"` audience (the platform share policy owns
   * guest run config). See {@link SessionRunConfig}.
   */
  readonly runConfig?: SessionRunConfig;
}

/** Return value of {@link useNewSessionFlow}. */
export interface UseNewSessionFlowReturn {
  /**
   * The engine the conversation will run: the person's pick on this
   * surface, else the selected agent's engine when it names one, else the
   * remembered and seeded choices (see `accountDefaults`). A pick is
   * remembered in localStorage.
   */
  readonly harness: HarnessOption;
  /** Switch the harness. Resets the model if invalid for the new harness. */
  readonly setHarness: (harness: HarnessOption) => void;

  /**
   * The model an untouched send asks for. Where the selected agent names a
   * model for the active engine, only a pick made on this surface (the
   * agent's default applies otherwise, and this is `undefined`). Elsewhere
   * the explicit device pick when one exists (persisted per-harness to
   * localStorage), else the account default for the active harness;
   * `undefined` resolves to the harness default downstream.
   */
  readonly modelId: string | undefined;

  /**
   * The selected agent's run defaults that apply on the active engine:
   * pass it to the composer's `agentRunDefaults`. `undefined` with no
   * agent, an agent that names no model for this engine, a guest, and
   * while the agent loads.
   */
  readonly agentRunDefaults: AgentRunDefaults | undefined;
  /** Update the selected model. Automatically persists to localStorage. */
  readonly setModelId: (id: string) => void;
  /**
   * Forget the model the person picked on this surface, so the selected
   * agent's default model applies again: pass it to the composer's
   * `onModelPickCleared`. Picks are also forgotten when the agent
   * changes, and a pick the engine does not list when the engine changes.
   */
  readonly clearModelPick: () => void;

  /** Currently selected agent reference, or `null` for the built-in assistant. */
  readonly agentRef: ResourceRef | null;
  /** Update the selected agent reference. */
  readonly setAgentRef: (ref: ResourceRef | null) => void;

  /** How the selected agent's declared keys are supplied, or `null` with no agent. */
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

  /**
   * Pre-arm "auto-approve tool calls" for the session this surface will
   * create (stigmer/stigmer#816, the walk-away scenario). Seeded from the
   * account's `default_auto_approve` preference and the host's
   * `StigmerProvider` `approvalDefaults` (#302) — guests inherit neither;
   * the user's explicit flip (the Config facet switch) wins from then on.
   * Carried into the bootstrap create as `spec.auto_approve_all` — the
   * whole-run server-side bypass — so the first run stays covered even if
   * the user closes the tab.
   */
  readonly autoApproveAll: boolean;
  /** Set the user's explicit auto-approve choice for the created session. */
  readonly setAutoApproveAll: (value: boolean) => void;

  /** `true` while the create session + run flow is in flight. */
  readonly isSubmitting: boolean;
  /** Human-readable error from the last failed submission, or `null`. */
  readonly submitError: string | null;

  /**
   * Create a session with the first run.
   *
   * Composes all managed state (agent, workspace, MCP servers, skills,
   * model, session variables) into a single bootstrap RPC —
   * `run.create` with an embedded session spec — then calls
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
 * variables. On submission, creates the session and its first run
 * with a single one-call bootstrap RPC (`run.create` with an
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
  // Guests never inherit account defaults — the platform share policy owns
  // guest run config (GUEST_HARNESS reasoning), and identity-derived
  // preferences must never shape a share/embed surface.
  const accountDefaults = isGuest ? undefined : options.accountDefaults;
  // Guests never carry a client pin: guest run config is owned by
  // the server-side share policy (GUEST_HARNESS reasoning). Validated at
  // render so a statically-wrong pin (fast tier, no model) fails in the
  // embedder's dev loop, not as the end user's failed send.
  const runConfig = isGuest ? undefined : options.runConfig;
  if (runConfig) assertValidRunConfig(runConfig);
  const pinnedModelName = runConfig?.modelName;
  const pinnedServiceTier = runConfig?.serviceTier;
  const pinnedThinkingMode = runConfig?.thinkingMode;
  const contextTarget = useExecutionTarget();
  const executionTarget = options.executionTarget ?? contextTarget;
  const adapter = useRunnerAdapter();
  // Auto-approve for the session about to be created (#816): derived like
  // useSessionPageFlow's — the user's explicit flip wins, otherwise the
  // truth is computed from its seeds:
  //
  //   effective = userChoice ?? (accountSeed || hostSeed)
  //
  // Derived rather than useState-initialized because the account preference
  // (default_auto_approve) resolves async with whoAmI — a mount-time
  // initializer would silently miss it (the harness seed's late-arrival
  // problem, solved here by derivation instead of a touched-ref effect).
  // Guests inherit neither seed — a share-link visitor is not the operator
  // either trust judgment covers (the GUEST_HARNESS fixed-platform-policy
  // reasoning). Carried into the bootstrap create as spec.auto_approve_all,
  // the whole-run server-side bypass — the created run stays covered even
  // if this tab dies before its first gate.
  const approvalDefaults = useApprovalDefaults();
  const [autoApproveChoice, setAutoApproveAll] = useState<boolean | null>(null);
  const autoApproveAll =
    autoApproveChoice ??
    (!isGuest &&
      ((accountDefaults?.autoApprove ?? false) ||
        (approvalDefaults?.autoApproveAll ?? false)));

  const [storedHarness, setHarnessRaw] = useState<HarnessOption>(() => {
    // Guests get the fixed platform policy (see GUEST_HARNESS) and never
    // touch localStorage: a browser previously used in the Console must not
    // leak its stored harness into a share/embed session.
    if (isGuest) return GUEST_HARNESS;
    if (typeof window === "undefined")
      return accountDefaults?.harness ?? defaultHarness ?? DEFAULT_HARNESS;
    // Only explicit user choices are persisted (see setHarness), so a
    // stored value always outranks the account default and the embedder's
    // defaultHarness.
    const stored = localStorage.getItem(STORAGE_KEY_HARNESS);
    if (stored === "native" || stored === "cursor") return stored;
    return accountDefaults?.harness ?? defaultHarness ?? DEFAULT_HARNESS;
  });
  // Set once the user picks a harness this mount — a late-arriving account
  // default must never override an explicit choice (the composer's
  // userOverrodeModel idiom), and the selected agent's engine only opens
  // the picker: the person's pick on this surface wins over it.
  const harnessTouchedRef = useRef(false);
  const [harnessPicked, setHarnessPicked] = useState(false);

  // Account defaults resolve async (whoAmI): when the harness seed arrives
  // after mount, apply it once — unless the user has picked or a stored
  // choice exists. Never persisted: seeding must not masquerade as a user
  // choice, or the account preference would stop applying elsewhere.
  useEffect(() => {
    const seed = accountDefaults?.harness;
    if (isGuest || harnessTouchedRef.current || !seed) return;
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY_HARNESS)) return;
    setHarnessRaw(seed);
  }, [isGuest, accountDefaults?.harness]);

  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);

  // The selected agent at its current version (what a new conversation
  // pins). Its engine opens the engine picker where the agent names one: a
  // remembered or seeded engine applies only where it names none. Guests
  // read nothing: the share policy fixes their engine.
  const { spec: agentSpec, isLoading: isAgentLoading } = useRunAgentSpec(isGuest ? null : agentRef);
  const agentHarness = agentHarnessOf(agentSpec);
  const harness: HarnessOption =
    !isGuest && !harnessPicked && agentHarness !== undefined
      ? agentHarness
      : storedHarness;
  const agentRunDefaults = agentRunDefaultsFor(
    isGuest ? undefined : agentSpec,
    harness,
  );

  const { getModel, isLoading: isModelsLoading } = useModelRegistry({ harness });
  const { create: createExecution } = useCreateRun();
  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();

  const [modelId, setModelIdRaw] = useState<string | undefined>(undefined);
  // The model the person picked on this surface (the composer's picker),
  // as opposed to one restored from storage: only a pick overrides the
  // agent's default model.
  const [pickedModelId, setPickedModelId] = useState<string | undefined>(undefined);
  const setModelId = useCallback((id: string) => {
    setPickedModelId(id);
    setModelIdRaw(id);
  }, []);
  const clearModelPick = useCallback(() => {
    setPickedModelId(undefined);
  }, []);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;

  // The person's model pick belongs to the agent and the engine it was
  // made under. A new agent drops it: the agent's own default is what a
  // person choosing that agent expects, and a pick sent on would override
  // it unseen. An engine change for any other reason than the person's
  // engine pick (an agent naming its engine, perhaps after the pick, as
  // its spec loads) drops a model the new engine does not list, as the
  // engine pick does: a model name sent with an engine that does not run
  // it silently runs another model, or none. The remembered model is
  // realigned the same way, so the persist effect never files one
  // engine's model under the other's key. Adjusted while rendering, so no
  // commit ever pairs the new engine with the old model.
  const agentKey = agentRef ? `${agentRef.org}/${agentRef.slug}` : "";
  const [pickScope, setPickScope] = useState({ agentKey, harness });
  if (pickScope.agentKey !== agentKey || pickScope.harness !== harness) {
    setPickScope({ agentKey, harness });
    if (
      pickedModelId !== undefined
      && (pickScope.agentKey !== agentKey || getModel(pickedModelId) === undefined)
    ) {
      setPickedModelId(undefined);
    }
    if (pickScope.harness !== harness && validModelId === undefined && modelId !== undefined) {
      setModelIdRaw(undefined);
    }
  }

  // The account's model for the active harness, registry-validated the same
  // way as the stored choice (a stale/removed preference silently falls
  // through to the harness default — self-healing). Derived, never written
  // into `modelId` state: the persist effect below stores only explicit
  // choices, and a derived seed cannot leak into localStorage.
  const accountModelForHarness =
    harness === "cursor" ? accountDefaults?.cursorModel : accountDefaults?.nativeModel;
  const accountModelId =
    accountModelForHarness && getModel(accountModelForHarness)
      ? accountModelForHarness
      : undefined;

  // Layered precedence: explicit device pick > account default. The result
  // feeds the composer's model pill AND the submit path, so the pill always
  // shows what an untouched send will run (#663). Where the agent names a
  // model for this engine, the pill shows the agent's default and an
  // untouched send asks for nothing: only a pick made here is sent.
  const effectiveModelId = agentRunDefaults
    ? (pickedModelId && getModel(pickedModelId) ? pickedModelId : undefined)
    : (validModelId ?? accountModelId);

  const setHarness = useCallback(
    (h: HarnessOption) => {
      harnessTouchedRef.current = true;
      setHarnessPicked(true);
      setHarnessRaw(h);
      // A model belongs to one engine: a pick made for the previous engine
      // is not a pick on this one.
      setPickedModelId(undefined);
      // Guests have no harness picker; if a caller invokes this anyway, the
      // guest surface must never write into the Console's preference keys.
      if (isGuest) return;
      // Persist only explicit choices — never the seeded value — so the
      // embedder's defaultHarness keeps applying until the user decides.
      localStorage.setItem(STORAGE_KEY_HARNESS, h);
      const storedModel = localStorage.getItem(modelStorageKey(h));
      const plain = storedModel ? (parseModelKey(storedModel)?.modelId ?? storedModel) : undefined;
      setModelIdRaw(plain);
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
        setModelIdRaw(plain);
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
          ? await resolveRunRuntimeEnv(getRuntimeEnv, context?.runtimeEnv)
          : context?.runtimeEnv;

        const sessionSpecBase = {
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
          // The typed-wins merge happens downstream in useCreateRun;
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
          // preference (#664), its tier and thinking as the surface set
          // them. The effective model carries the account-default seed
          // explicitly (the preference is a seed; the run spec is
          // the record); where the agent's default applies it is absent.
          // The composer's context carries only the tier and thinking the
          // person chose.
          modelName: pinnedModelName ?? selectedModel ?? effectiveModelId,
          runtimeEnv,
          attachments: context?.attachments,
          interactionMode: context?.interactionMode,
          serviceTier: pinnedModelName ? pinnedServiceTier : context?.serviceTier,
          thinkingMode: pinnedModelName ? pinnedThinkingMode : context?.thinkingMode,
          workspaceFileRefs: context?.workspaceFileRefs,
          // Only an armed state travels; false stays off the wire (the
          // serviceTier/thinkingMode only-explicit discipline).
          autoApproveAll: autoApproveAll || undefined,
        };

        // What the conversation runs: the selected agent, named by the
        // reference exactly as the flow holds it (the server pins the
        // version it names, the agent's current one when it names none),
        // or nothing at all — the built-in assistant.
        let sessionAgentRef: ResourceRef | undefined;

        if (agentRef && resolution) {
          // The agent's engine and run defaults decide what this
          // conversation starts on: a send made before they are read would
          // start it on the remembered engine instead.
          if (!isGuest && isAgentLoading) {
            throw new Error(
              "This agent is still loading. Please try again in a moment.",
            );
          }
          sessionAgentRef = agentRef;
        } else if (isGuest) {
          // Fail closed: a guest session is only ever created against the
          // pinned shared agent's resolution. Reaching here means the pin
          // has not been applied yet (or was cleared) — an anonymous
          // visitor never gets the built-in assistant either.
          throw new Error(
            "This agent is still loading. Please try again in a moment.",
          );
        }

        // One-call bootstrap: the embedded session spec and the first
        // message travel in a single create — the server creates the
        // session and dispatches the run atomically.
        const { sessionId } = await createExecution({
          ...executionFields,
          sessionSpec: { ...sessionSpecBase, agentRef: sessionAgentRef },
        });

        // Local run: attach the session's runner worker now that the
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
      effectiveModelId,
      pinnedModelName,
      pinnedServiceTier,
      pinnedThinkingMode,
      workspace,
      mcpServerUsages,
      skillRefs,
      metadata,
      sessionContext,
      agentRef,
      resolution,
      isAgentLoading,
      createExecution,
      sessionVariables,
      onSessionCreated,
      onError,
    ],
  );

  return {
    harness,
    setHarness,
    modelId: effectiveModelId,
    setModelId,
    clearModelPick,
    agentRunDefaults,
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
    autoApproveAll,
    setAutoApproveAll,
    isSubmitting,
    submitError,
    submit,
  };
}
