"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUserMessage, type ResourceRef } from "@stigmer/client";
import { accountDefaultModel, type AccountExecutionDefaults } from "../identity-account/useAccountExecutionDefaults.js";
import type { AgentResolution } from "../agent/index.js";
import { useModelRegistry } from "../models/index.js";
import { parseModelKey } from "@stigmer/react-core";
import { DEFAULT_HARNESS, type HarnessOption } from "@stigmer/react-core";
import { isHarnessOption } from "@stigmer/react-core/internal";
import { modelStorageKey } from "./usePersistedModel.js";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace/index.js";

import type { SessionComposerSubmitContext } from "../composer/index.js";
import { useCreateRun } from "@stigmer/react-core";
import { useExecutionTarget } from "@stigmer/react-core/internal";
import { useApprovalDefaults } from "../approval-defaults-context.js";
import { useRunnerAdapter } from "@stigmer/react-core";
import { includesMyVaultByDefault, type SessionAudience } from "./audience.js";
import { assertValidRunConfig, type SessionRunConfig } from "./run-config.js";
import {
  agentHarnessOf,
  agentRunDefaultsFor,
  type AgentRunDefaults,
} from "../agent/run-defaults.js";
import { useRunAgentSpec } from "../agent/useRunAgentSpec.js";
import { environmentsNotApplying, type EnvironmentReference } from "../environment/resolve.js";
import { useOrganization } from "../organization/useOrganization.js";
import { useEnvironmentAvailability } from "../server-info.js";
import { toError } from "@stigmer/react-core/internal";
import { readRememberedPluginPicks, rememberPluginPicks } from "../plugin/rememberedPluginPicks.js";

const STORAGE_KEY_HARNESS = "stigmer:session:harness";

/**
 * Platform policy for guest (share/embed) sessions: the session names no
 * engine and the run names no model, so the server starts the conversation
 * on the engine the chat link's agent names (Stigmer when it names none) and the
 * run takes the agent's own defaults. A guest runs the agent as its owner
 * built it, on the organization's own provider keys; nothing a visitor's
 * browser holds shapes it.
 *
 * This lives CLIENT-side deliberately — it is the only layer that can. The
 * SDK's guest audience covers both public visitors (guest tokens) and org
 * members chatting via an org-audience share (their own member tokens, which
 * carry no chat-link linkage) — the server cannot distinguish the
 * latter from ordinary Console traffic, so share-surface policy must be
 * applied where the surface is known. Server-side guest-token gates own the
 * abuse controls (rate limits, bounded run profile).
 *
 * The flow still holds a harness for a guest, the platform default, because
 * its model registry and pickers read one; a guest surface shows neither,
 * and the create carries none.
 */
const GUEST_LOCAL_HARNESS: HarnessOption = DEFAULT_HARNESS;

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
   * Called when an error occurs during session creation, with its message
   * and the error itself (so a host can skip a refusal it renders in place,
   * such as `PROVIDER_KEY_REQUIRED`). The consumer can use this for toast
   * notifications or other UI feedback. If not provided, errors are still
   * available via {@link UseNewSessionFlowReturn.submitError}.
   */
  readonly onError?: (message: string, error: Error) => void;
  /**
   * Whether the created conversation includes its sender's own My vault,
   * read first, ahead of {@link vaults}. A pick the person makes in the
   * composer's vault picker (`SessionComposerSubmitContext.includeMyVault`)
   * wins. Defaults to on for the `"integrator"` and `"endUser"` audiences
   * and off for `"guest"`: a chat-link guest brings no keys, and the
   * link's vaults are what its runs use.
   */
  readonly includeMyVault?: boolean;
  /**
   * Shared vaults the created conversation uses, in order, after the
   * sender's My vault when it is included. A pick the person makes in the
   * composer's vault picker (`SessionComposerSubmitContext.vaults`) wins.
   */
  readonly vaults?: readonly ResourceRef[];
  /**
   * Harness pre-selected for new sessions when the user has not made an
   * explicit choice yet (e.g. an embedder whose agents primarily run
   * coding tasks defaults to `"claude"`).
   *
   * Read once on mount. The user's own selection — persisted to
   * localStorage on explicit change — always takes precedence on
   * subsequent visits.
   *
   * Ignored for the `"guest"` audience: a guest session runs the chat
   * link's agent on its own harness and defaults (the guest policy note on
   * `GUEST_LOCAL_HARNESS`), never an embedder preference or a stored Console
   * choice.
   *
   * @default DEFAULT_HARNESS ("stigmer")
   */
  readonly defaultHarness?: HarnessOption;
  /**
   * The user's account-level execution defaults
   * (`IdentityAccountPreferences.default_*`), typically from
   * `useAccountExecutionDefaults()`. A SEED in the layered precedence —
   * explicit device-local choices always outrank it:
   *
   * - harness: the person's pick on this surface > the selected agent's
   *   harness (`AgentSpec.harness`) > stored choice >
   *   `accountDefaults.harness` > {@link defaultHarness} > platform
   *   default. May arrive after mount (whoAmI resolves async); a late
   *   value still seeds unless the user has already picked a harness
   *   this mount.
   * - model: where the selected agent names a model for the active
   *   harness, nothing unless the person picks one on this surface (the
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
   * — a chat link must never run anything but its pinned agent. See {@link SessionAudience}.
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
   * returns it, so never put secrets here; secrets belong in a vault.
   * Large values bloat every prompt.
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
  /**
   * Plugins the new conversation starts with, taken once: on mount, or
   * when they first arrive after it (a host that reads them from its URL
   * after hydration) unless the person has picked by then. A plugin
   * page's "Start a chat" arrives with its plugin here. Ignored for the
   * `"guest"` audience, whose conversation is the chat link's.
   */
  readonly initialPluginRefs?: readonly ResourceRef[];
  /**
   * Remember the person's plugin picks in this browser, per organization,
   * and start the next new conversation with them (unless
   * `initialPluginRefs` names plugins). A per-viewer convenience kept in
   * `localStorage`; nothing reaches the server or another person. Ignored
   * for the `"guest"` audience.
   *
   * @default false
   */
  readonly rememberPluginPicks?: boolean;
}

/** Return value of {@link useNewSessionFlow}. */
export interface UseNewSessionFlowReturn {
  /**
   * The harness the conversation will run: the person's pick on this
   * surface, else the selected agent's harness when it names one, else the
   * remembered and seeded choices (see `accountDefaults`). A pick is
   * remembered in localStorage.
   */
  readonly harness: HarnessOption;
  /** Switch the harness. Resets the model if invalid for the new harness. */
  readonly setHarness: (harness: HarnessOption) => void;

  /**
   * The model an untouched send asks for. Where the selected agent names a
   * model for the active harness, only a pick made on this surface (the
   * agent's default applies otherwise, and this is `undefined`). Elsewhere
   * the explicit device pick when one exists (persisted per-harness to
   * localStorage), else the account default for the active harness;
   * `undefined` resolves to the harness default downstream.
   */
  readonly modelId: string | undefined;

  /**
   * The selected agent's run defaults that apply on the active harness:
   * pass it to the composer's `agentRunDefaults`. `undefined` with no
   * agent, an agent that names no model for this harness, a guest, and
   * while the agent loads.
   */
  readonly agentRunDefaults: AgentRunDefaults | undefined;
  /**
   * Whether the new conversation may pick its Environment: `false` for a
   * guest, for a conversation on the person's own machine, and on a server
   * whose conversations no Environment governs. Pass it to the composer's
   * `enableEnvironmentPicker`.
   */
  readonly offersEnvironment: boolean;
  /**
   * What applies when the person picks no Environment: the selected
   * agent's default and the organization's. Pass it to the composer's
   * `environmentDefaults`.
   */
  readonly environmentDefaults: {
    readonly agent?: EnvironmentReference;
    readonly organization?: EnvironmentReference;
  };
  /** Update the selected model. Automatically persists to localStorage. */
  readonly setModelId: (id: string) => void;
  /**
   * Forget the model the person picked on this surface, so the selected
   * agent's default model applies again: pass it to the composer's
   * `onModelPickCleared`. Picks are also forgotten when the agent
   * changes, and a pick the harness does not list when the harness changes.
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

  /** Plugins the new conversation uses, each whole. */
  readonly pluginRefs: ResourceRef[];
  /** Update the plugins the new conversation uses (remembered when `rememberPluginPicks` is set). */
  readonly setPluginRefs: (refs: ResourceRef[]) => void;

  /** Active skill references. */
  readonly skillRefs: ResourceRef[];
  /** Update skill references. */
  readonly setSkillRefs: (refs: ResourceRef[]) => void;

  /** Workspace entries manager (git repos and local paths). */
  readonly workspace: UseWorkspaceEntriesReturn;

  /**
   * Pre-arm "auto-approve tool calls" for the session this surface will
   * create (stigmer/stigmer#816, the walk-away scenario). Seeded from the
   * account's `default_auto_approve` preference and the host's
   * `StigmerProvider` `approvalDefaults` (#302) — guests inherit neither;
   * the user's explicit flip (the run settings switch) wins from then on.
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
   * The last failed submission's error itself, or `null`: for a caller that
   * renders a typed refusal (a `PROVIDER_KEY_REQUIRED` one, say) by its
   * reason rather than its text.
   */
  readonly submitFailure: Error | null;

  /**
   * Create a session with the first run.
   *
   * Composes all managed state (agent, workspace, plugins, skills,
   * model, the vaults the conversation uses) into a single bootstrap RPC —
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
 * plugin/skill selection, workspace entries, and the vaults the
 * conversation uses. On submission, creates the session and its first run
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
 *   pluginRefs={flow.pluginRefs}
 *   onPluginRefsChange={flow.setPluginRefs}
 *   skillRefs={flow.skillRefs}
 *   onSkillRefsChange={flow.setSkillRefs}

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
    includeMyVault: includeMyVaultOption,
    vaults: vaultsOption,
    defaultHarness,
    metadata,
    sessionContext,
  } = options;
  const isGuest = options.audience === "guest";
  // Guests never inherit account defaults — the platform share policy owns
  // guest run config (the guest policy note on GUEST_LOCAL_HARNESS), and
  // identity-derived preferences must never shape a share/embed surface.
  const accountDefaults = isGuest ? undefined : options.accountDefaults;
  // Guests never carry a client pin: guest run config is owned by the
  // server-side share policy (the guest policy note on GUEST_LOCAL_HARNESS).
  // Validated at render so a statically-wrong pin (fast tier, no model)
  // fails in the embedder's dev loop, not as the end user's failed send.
  const runConfig = isGuest ? undefined : options.runConfig;
  if (runConfig) assertValidRunConfig(runConfig);
  const pinnedModelName = runConfig?.modelName;
  const pinnedServiceTier = runConfig?.serviceTier;
  const pinnedThinkingMode = runConfig?.thinkingMode;
  // Where session activities execute: `StigmerProvider`'s `executionTarget`;
  // unset, the server decides from its deployment.
  const executionTarget = useExecutionTarget();
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
  // Guests inherit neither seed — a chat-link visitor is not the operator
  // either trust judgment covers (the guest policy note on
  // GUEST_LOCAL_HARNESS). Carried into the bootstrap create as spec.auto_approve_all,
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
    // Guests follow the guest policy (see GUEST_LOCAL_HARNESS) and never
    // touch localStorage: a browser previously used in the Console must not
    // leak its stored harness into a share/embed session.
    if (isGuest) return GUEST_LOCAL_HARNESS;
    if (typeof window === "undefined")
      return accountDefaults?.harness ?? defaultHarness ?? DEFAULT_HARNESS;
    // Only explicit user choices are persisted (see setHarness), so a
    // stored value always outranks the account default and the embedder's
    // defaultHarness.
    const stored = localStorage.getItem(STORAGE_KEY_HARNESS);
    if (stored !== null && isHarnessOption(stored)) return stored;
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

  // The Environment the conversation runs in: picked in the composer, or
  // the agent's default, else the organization's, which the server
  // resolves in that order. A guest picks none (a chat link's conversation
  // takes its agent's), and none applies on the person's own machine or on
  // a server whose conversations run in no sandbox it starts.
  const environmentAvailability = useEnvironmentAvailability();
  const offersEnvironment =
    !isGuest && environmentsNotApplying(environmentAvailability, executionTarget) === undefined;
  const { organization } = useOrganization(offersEnvironment ? org : null);
  const agentEnvironment = agentSpec?.environmentRef;
  const organizationEnvironment = organization?.spec?.preferences?.defaultEnvironmentRef;
  const environmentDefaults = useMemo(
    () => ({ agent: agentEnvironment, organization: organizationEnvironment }),
    [agentEnvironment, organizationEnvironment],
  );

  const { getModel, isLoading: isModelsLoading } = useModelRegistry({ harness });
  const { create: createExecution } = useCreateRun();
  const workspace = useWorkspaceEntries();

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
  const remembersPicks = !isGuest && options.rememberPluginPicks === true;
  const seed = isGuest ? undefined : options.initialPluginRefs;
  // Set once the seed is taken or the person picks: a seed is applied at
  // most once and never over a pick.
  const pluginsSettledRef = useRef(seed !== undefined && seed.length > 0);
  const [pluginRefs, setPluginRefsRaw] = useState<ResourceRef[]>(() => {
    if (isGuest) return [];
    if (seed !== undefined && seed.length > 0) return [...seed];
    return remembersPicks ? readRememberedPluginPicks(org) : [];
  });
  // Keyed by content: hosts pass a fresh array per render.
  const seedKey = (seed ?? []).map((ref) => `${ref.org}/${ref.slug}`).join(",");
  const seededRefs = useMemo(() => seed ?? [], [seedKey]);
  useEffect(() => {
    if (pluginsSettledRef.current || seededRefs.length === 0) return;
    pluginsSettledRef.current = true;
    setPluginRefsRaw([...seededRefs]);
  }, [seededRefs]);
  // Only the person's own picks are remembered, never a seed.
  const setPluginRefs = useCallback(
    (refs: ResourceRef[]) => {
      pluginsSettledRef.current = true;
      setPluginRefsRaw(refs);
      if (remembersPicks) rememberPluginPicks(org, refs);
    },
    [remembersPicks, org],
  );
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<Error | null>(null);

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
  const accountModelForHarness = accountDefaultModel(accountDefaults, harness);
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
      setModelIdRaw(localStorage.getItem(modelStorageKey(h)) ?? undefined);
    },
    [isGuest],
  );

  // Restore persisted model — only after the registry has loaded so
  // getModel can actually validate the stored ID against live data.
  // Guests skip the restore: modelId stays undefined, the create omits
  // modelName, and the run takes the chat link's agent's default — a Console-used
  // browser must not leak its stored model into a share/embed session.
  useEffect(() => {
    if (isGuest || isModelsLoading) return;
    const stored = localStorage.getItem(modelStorageKey(harness));
    if (stored && getModel(stored)) {
      setModelIdRaw(stored);
    }
  }, [getModel, harness, isGuest, isModelsLoading]);

  // Persist model on change (using current harness key).
  // Strip compound keys (e.g. "claude/claude-sonnet-4.6") to plain modelId before storing.
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
        onError?.(msg, new Error(msg));
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);
      setSubmitFailure(null);

      try {
        // The vaults the conversation uses: the person's pick in the
        // composer when they made one, else what the host set up. The pick
        // carries both halves together, so neither is mixed from two
        // sources. A guest's pick is never taken: what a chat-link
        // conversation reads is the host's to say, as on every follow-up.
        const pick = isGuest ? undefined : context;
        const includeMyVault = pick?.includeMyVault
          ?? includeMyVaultOption
          ?? includesMyVaultByDefault(options.audience ?? "integrator");
        const vaults = pick?.vaults ?? vaultsOption;

        const sessionSpecBase = {
          resources: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          plugins: pluginRefs.length > 0 ? pluginRefs : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
          vaults: vaults?.length ? [...vaults] : undefined,
          // Only an included My vault travels; off is the wire default.
          includeMyVault: includeMyVault || undefined,
          // The person's pick only; left empty, the server resolves the
          // agent's default, else the organization's.
          environmentRef: offersEnvironment ? pick?.environmentRef : undefined,
          // The console offers each turn's edits for Keep and Undo after
          // the turn; every other client leaves review off.
          fileReview: true,
          // The typed-wins merge happens downstream in useCreateRun;
          // both fields are forwarded verbatim here.
          metadata,
          sessionContext,
          // A guest's session names no engine: the server starts it on the
          // engine the chat link's agent names (the guest policy note).
          harness: isGuest ? undefined : harness,
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
          fileIds: context?.fileIds,
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
          // chat link's pinned agent's resolution. Reaching here means the pin
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
        // The run exists and names the person's own Files; the new
        // conversation holds its copies, so the originals can go.
        void context?.releaseFiles?.();

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

        onSessionCreated(sessionId);
      } catch (err) {
        // The chat box has already let go of the Files and nothing names
        // them again (another attempt uploads afresh), so a failed start
        // leaves no File of the person's behind either.
        void context?.releaseFiles?.();
        const detail = getUserMessage(err, "Failed to start session");
        const failure = toError(err);
        setSubmitError(detail);
        setSubmitFailure(failure);
        onError?.(detail, failure);
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
      offersEnvironment,
      autoApproveAll,
      adapter,
      includeMyVaultOption,
      vaultsOption,
      options.audience,
      effectiveModelId,
      pinnedModelName,
      pinnedServiceTier,
      pinnedThinkingMode,
      workspace,
      pluginRefs,
      skillRefs,
      metadata,
      sessionContext,
      agentRef,
      resolution,
      isAgentLoading,
      createExecution,
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
    offersEnvironment,
    environmentDefaults,
    agentRef,
    setAgentRef,
    resolution,
    setResolution,
    pluginRefs,
    setPluginRefs,
    skillRefs,
    setSkillRefs,
    workspace,
    autoApproveAll,
    setAutoApproveAll,
    isSubmitting,
    submitError,
    submitFailure,
    submit,
  };
}
