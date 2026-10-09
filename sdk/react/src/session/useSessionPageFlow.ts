"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { AgentResolution } from "../agent/index.js";
import { useApprovalDefaults } from "../approval-defaults-context.js";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace/index.js";
import { useSessionVariables, type UseSessionVariablesReturn } from "../run/useSessionVariables.js";
import type { SessionComposerSubmitContext, InteractionModeOption } from "../composer/index.js";
import { fromProtoInteractionMode } from "../composer/index.js";
import { fromProtoHarness, type HarnessOption } from "../models/harness.js";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { fromProtoExecutionTarget, type ExecutionTargetOption } from "./execution-target.js";
import { useSessionConversation, type UseSessionConversationReturn } from "./useSessionConversation.js";
import { resolveSessionSecrets, type SessionSecretsProvider } from "./session-secrets.js";
import { agentRefOfSession, isSameAgent } from "./agentRefOfSession.js";
import { useSessionAgentVersion, type UseSessionAgentVersionReturn } from "./useSessionAgentVersion.js";
import { usePersistedModel, type UsePersistedModelReturn } from "./usePersistedModel.js";
import { toSessionUpdateInput } from "@stigmer/sdk";
import type { SessionAudience } from "./audience.js";
import { isChannelOriginSession } from "./channelOrigin.js";
import { assertValidRunConfig, type SessionRunConfig } from "./run-config.js";
import type { AccountExecutionDefaults } from "../identity-account/useAccountExecutionDefaults.js";
import { agentRunDefaultsFor, type AgentRunDefaults } from "../agent/run-defaults.js";
import { useRunAgentSpec } from "../agent/useRunAgentSpec.js";

/**
 * Well-known Daytona sandbox workspace root. Used as the SDK safety-net
 * normalization target for cloud sessions (git-repo workspace entries).
 */
const DAYTONA_WORKSPACE_ROOT = "/home/daytona/workspace";

/** Options for {@link useSessionPageFlow}. */
export interface UseSessionPageFlowOptions {
  /** Session ID to load and manage. */
  readonly sessionId: string;
  /** Organization id (a slug is also accepted). */
  readonly org: string;
  /**
   * Supplies host-app environment variables for every follow-up
   * run. Evaluated once per follow-up, at send time, so
   * short-lived credentials stay fresh.
   *
   * Host values win over composer-collected env on key collisions. If
   * the provider throws, the follow-up is aborted before any optimistic
   * UI or session mutation and the error surfaces via
   * {@link UseSessionPageFlowReturn.submitError}. See
   * {@link SessionSecretsProvider}.
   *
   * The values are written to the conversation's own secrets by a
   * session update before the run. Not evaluated for the `"guest"`
   * audience: a share-link guest cannot write them, and the share's
   * vaults are what a guest's runs use.
   */
  readonly getSessionSecrets?: SessionSecretsProvider;
  /**
   * Who this flow serves. `"guest"` adapts the orchestration to the
   * guest principal's permission model: the agent reads behind the
   * version state (a read a guest token cannot make) are skipped, and
   * follow-ups carry no agent override, so they simply continue on the
   * agent and version the session pinned, which is exactly right for a
   * shared-agent page.
   * See {@link SessionAudience}.
   *
   * @default "integrator"
   */
  readonly audience?: SessionAudience;
  /**
   * Owner-pinned model/tier for every follow-up on this surface
   * (stigmer/stigmer#664). Stamped at submit — after the composer, so
   * it wins over composer state, the persisted Console preference, and
   * the last execution's model — and therefore also covers retries,
   * which re-enter the same submit path. Ignored for the `"guest"`
   * audience (the server-side share policy owns guest run
   * config). See {@link SessionRunConfig}.
   */
  readonly runConfig?: SessionRunConfig;
  /**
   * The user's account-level execution defaults, typically from
   * `useAccountExecutionDefaults()`. On the session page only
   * `autoApprove` applies — it seeds the session-scoped auto-approve
   * state so a user whose `default_auto_approve` preference is ON gets
   * armed follow-ups on every session, not just newly created ones. An
   * explicit in-session flip always wins for this session; the seed may
   * arrive after mount (whoAmI resolves async) and still applies, being
   * part of the derivation rather than an initializer. Ignored for the
   * `"guest"` audience (guests inherit no identity-derived preference).
   */
  readonly accountDefaults?: AccountExecutionDefaults;
}

/** Return value of {@link useSessionPageFlow}. */
export interface UseSessionPageFlowReturn {
  /** Full conversation state from `useSessionConversation`. */
  readonly conv: UseSessionConversationReturn;

  /**
   * Session's run harness (read-only, derived from session spec).
   *
   * Use this to:
   * - Filter the model selector for follow-up messages
   * - Render a harness badge in the session header
   *
   * Defaults to `"native"` while the session is loading.
   */
  readonly harness: HarnessOption;

  /**
   * Where session activities execute (read-only, derived from session spec).
   *
   * `"local"` when the client's embedded runner handles activities,
   * `"cloud"` when the server provisions a sandbox, or `undefined`
   * when the server decides (UNSPECIFIED).
   */
  readonly executionTarget: ExecutionTargetOption | undefined;

  /**
   * Model selection: `[modelId, setModelId]`. The model is the one the
   * last message asked for (`spec.run_config`, what the person picked,
   * never what the server resolved), so a follow-up keeps the person's
   * pick and never copies an agent default into the next message. Where
   * the agent names no model for this conversation's engine, a model
   * remembered on this device comes first. The setter remembers the pick.
   */
  readonly model: UsePersistedModelReturn;

  /**
   * The agent's run defaults that apply to the next message: the model,
   * tier and thinking of the agent version the conversation runs, when it
   * names a model for the engine this conversation runs. Pass it to the
   * composer's `agentRunDefaults` so an untouched send asks for nothing
   * and the server applies them. `undefined` for the built-in assistant,
   * an agent that names none for this engine, a guest, and while the
   * agent loads.
   */
  readonly agentRunDefaults: AgentRunDefaults | undefined;
  /**
   * Choose the agent's default model back: the next message names no
   * model, not even this conversation's last pick, until the person picks
   * one again. Pass it to the composer's `onModelPickCleared`.
   */
  readonly clearModelPick: () => void;

  /**
   * Composer interaction mode: `[interactionMode, setInteractionMode]`.
   *
   * Derived like {@link model}: the user's explicit override wins, otherwise
   * it reflects the latest execution's mode (so a completed Plan keeps the
   * picker on "Plan" while it awaits review), falling back to `"agent"`.
   */
  readonly interactionMode: readonly [
    InteractionModeOption,
    (mode: InteractionModeOption) => void,
  ];

  /**
   * Currently selected agent reference (derived from session, or overridden
   * by user); `null` is the built-in assistant.
   */
  readonly agentRef: ResourceRef | null;
  /**
   * Update the agent reference for future follow-ups. `null` is the drop:
   * the same act as {@link clearAgent}, reached from the composer's picker.
   */
  readonly setAgentRef: (ref: ResourceRef | null) => void;
  /** Current agent resolution state. */
  readonly resolution: AgentResolution | null;
  /** Update the agent resolution. */
  readonly setResolution: (r: AgentResolution | null) => void;
  /**
   * Drop the session's agent: the next follow-up rebinds the session to
   * the built-in assistant (no `agentRef` on the wire), so the
   * conversation continues without an agent rather than only looking as
   * if it had. Picking an agent again undoes it.
   */
  readonly clearAgent: () => void;

  /**
   * The agent version this conversation runs against the version its
   * agent is at now, with the explicit act that moves the conversation to
   * the current one. Nothing else in this flow changes the version: a
   * follow-up that rewrites the session keeps its pin. Inert for guests.
   */
  readonly agentVersion: UseSessionAgentVersionReturn;

  /** Active MCP server configurations for follow-ups. */
  readonly mcpServerUsages: McpServerUsageInput[];
  /** Update MCP server configurations. */
  readonly setMcpServerUsages: (usages: McpServerUsageInput[]) => void;

  /** Active skill references for follow-ups. */
  readonly skillRefs: ResourceRef[];
  /** Update skill references. */
  readonly setSkillRefs: (refs: ResourceRef[]) => void;

  /** Workspace entries manager (synced from session on load). */
  readonly workspace: UseWorkspaceEntriesReturn;
  /** Session variables (per-execution secrets) manager. */
  readonly sessionVariables: UseSessionVariablesReturn;

  /**
   * Session-scoped "auto-approve tool calls" state (stigmer/stigmer#816).
   *
   * `false` by default. `true` when any of its sources arms it — the user's
   * explicit choice always winning:
   *
   * 1. the user's Config facet switch ({@link setAutoApproveAll});
   * 2. "Approve & don't ask again" at an approval gate (see
   *    {@link submitApproval});
   * 3. the account's `default_auto_approve` preference
   *    (`UseSessionPageFlowOptions.accountDefaults`, guests excluded);
   * 4. the host's app-wide `StigmerProvider` `approvalDefaults` (#302,
   *    guests excluded);
   * 5. the active in-flight run having been created with
   *    `spec.auto_approve_all` (e.g. armed on the new-session surface), so
   *    the state survives the launcher → session-page handoff.
   *
   * While `true`, follow-ups carry `auto_approve_all` ({@link handleSubmit})
   * and gates appearing in the in-flight run are auto-released (never for
   * guest/observer/channel-origin surfaces). The explicit per-session flip is
   * held in memory only — reset on reload back to the seeds; the account
   * preference is the one persisted default, declared by the user in
   * Account Preferences.
   */
  readonly autoApproveAll: boolean;
  /**
   * Set the user's explicit session-scoped auto-approve choice. Wired to the
   * Config facet's switch; an explicit `false` wins over both seeds and over
   * an armed in-flight run for everything the client controls (follow-up
   * carry, gate auto-release) — an already-armed run's server-side bypass
   * cannot be revoked mid-run, exactly as with today's gate-time "Approve &
   * don't ask again". Never written back to the account preference: the
   * flip is scoped to THIS conversation.
   */
  readonly setAutoApproveAll: (value: boolean) => void;

  /**
   * Submit an approval decision for a pending tool call.
   *
   * Wraps {@link UseSessionConversationReturn.submitApproval}: when the action is
   * `APPROVAL_ACTION_APPROVE_ALL`, it also flips the session-scoped
   * {@link autoApproveAll} preference so future follow-ups skip the gate. The
   * server independently auto-approves the rest of the current run.
   */
  readonly submitApproval: UseSessionConversationReturn["submitApproval"];

  /**
   * Submit a follow-up message. Handles agent override resolution
   * (if the user changed the agent mid-session), evaluates the host
   * runtime-env provider, and delegates to `conv.sendFollowUp` with
   * all managed state. Never rejects — pre-send failures land in
   * {@link submitError}.
   */
  readonly handleSubmit: (
    message: string,
    model?: string,
    context?: SessionComposerSubmitContext,
  ) => Promise<void>;

  /**
   * Error from the most recent follow-up's pre-send work (agent
   * override resolution, host runtime-env evaluation), or `null`.
   *
   * Distinct from `conv.sendError`, which covers the create-execution
   * RPC itself. Kept as the raw `Error` so consumers can render
   * contextual guidance (e.g. secret-flow errors). Cleared at the
   * start of each submission.
   */
  readonly submitError: Error | null;

  /**
   * The most relevant run for sidebar display — the active
   * streaming run, or the last completed one.
   */
  readonly displayRun: UseSessionConversationReturn["activeStreamRun"];

  /**
   * All runs for widget display (completed + active stream).
   */
  readonly allRuns: UseSessionConversationReturn["completedRuns"];

  /**
   * Sandbox workspace root for file path normalization, or `undefined`
   * when the session has no git-repo workspace entries.
   */
  readonly sandboxWorkspaceRoot: string | undefined;
}

/**
 * Orchestrates the session page experience.
 *
 * Composes `useSessionConversation` with agent resolution, workspace
 * synchronization, model persistence, and follow-up submission logic.
 * Returns everything a session page needs to render its UI without
 * duplicating domain orchestration.
 *
 * Framework-agnostic — works identically in Next.js, Vite, Tauri, or
 * any React environment. The consumer provides layout, error states,
 * and loading skeletons.
 *
 * @example
 * ```tsx
 * const flow = useSessionPageFlow({ sessionId: "ses_abc", org: "acme" });
 *
 * if (flow.conv.isLoading) return <Spinner />;
 * if (flow.conv.loadError) return <ErrorView error={flow.conv.loadError} />;
 *
 * return (
 *   <>
 *     <MessageThread
 *       runs={flow.conv.completedRuns}
 *       activeStreamRun={flow.conv.activeStreamRun}
 *       sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
 *     />
 *     <SessionComposer
 *       onSubmit={flow.handleSubmit}
 *       isSubmitting={flow.conv.isSending}
 *       disabled={!flow.conv.canSendFollowUp}
 *       workspace={flow.workspace}
 *       agentRef={flow.agentRef}
 *       onAgentRefChange={flow.setAgentRef}
 *       onAgentResolutionChange={flow.setResolution}
 *       defaultModelId={flow.model[0]}
 *       onModelChange={flow.model[1]}
 *     />
 *   </>
 * );
 * ```
 */
export function useSessionPageFlow(
  options: UseSessionPageFlowOptions,
): UseSessionPageFlowReturn {
  const { sessionId, org, getSessionSecrets } = options;
  const isGuest = options.audience === "guest";
  // Guests never carry a client pin: guest run config is owned by
  // the server-side share policy, and the no-modelName guest invariant
  // is test-pinned.
  const runConfig = isGuest ? undefined : options.runConfig;
  // Render-time, not submit-time: the pin is static host configuration,
  // so a statically-wrong shape (fast tier, no model) should fail at
  // mount in the embedder's dev loop — not as an end user's failed send.
  if (runConfig) assertValidRunConfig(runConfig);
  // Scalars, not the object: hosts pass inline literals, and the submit
  // callback's identity must not churn on every render.
  const pinnedModelName = runConfig?.modelName;
  const pinnedServiceTier = runConfig?.serviceTier;
  const pinnedThinkingMode = runConfig?.thinkingMode;

  const conv = useSessionConversation(sessionId, org);
  const harness: HarnessOption = fromProtoHarness(
    conv.session?.spec?.harness ?? Harness.UNSPECIFIED,
  );
  const executionTarget: ExecutionTargetOption | undefined = fromProtoExecutionTarget(
    conv.session?.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED,
  );
  // Guests never read or write the Console's persisted model preference —
  // their follow-ups carry no modelName, and the session's harness (cursor
  // for share surfaces) resolves the model server-side.
  const [persistedModelId, setPersistedModelId] = usePersistedModel({
    harness,
    enabled: !isGuest,
  });

  // The model the last message asked for: the REQUESTED settings, never
  // status.run_config, which records what the server resolved (an agent
  // default among them) and would copy that default into every later
  // message as if the person had picked it. Guests never seed: a guest's
  // turn runs the share's saved settings, which the server writes over
  // what the visitor sent.
  const lastRequestedModelId = useMemo(() => {
    if (isGuest) return undefined;
    const lastExec = conv.completedRuns.at(-1);
    return lastExec?.spec?.runConfig?.modelName || undefined;
  }, [isGuest, conv.completedRuns]);

  // Interaction mode mirrors the model derivation: an explicit user override
  // wins; otherwise reflect the latest execution's mode so a completed Plan
  // keeps the composer on "Plan" until the user implements or switches. This
  // is derived state (always consistent), never an effect-synced copy.
  const lastExecInteractionMode = useMemo(
    () =>
      fromProtoInteractionMode(
        conv.completedRuns.at(-1)?.spec?.interactionMode,
      ),
    [conv.completedRuns],
  );
  const [interactionModeOverride, setInteractionMode] =
    useState<InteractionModeOption | null>(null);
  const interactionMode: UseSessionPageFlowReturn["interactionMode"] = [
    interactionModeOverride ?? lastExecInteractionMode ?? "agent",
    setInteractionMode,
  ] as const;

  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const initialSyncDone = useRef(false);

  // Session-scoped auto-approve (#816). Derived like interactionMode above —
  // the user's explicit in-session decision wins, otherwise the truth is
  // computed from its sources — never an effect-synced copy:
  //
  //   effective = userChoice ?? (accountSeed || hostSeed || runArmed)
  //
  // - `userChoice`: the Config facet's switch, or the gate-time "Approve &
  //   don't ask again" (which has always escalated the session preference).
  // - `accountSeed`: the account's default_auto_approve preference — the
  //   user's own persisted walk-away default. Resolves async with whoAmI;
  //   being part of the derivation (not an initializer), a late arrival
  //   still applies unless the user has already flipped this session.
  // - `hostSeed`: the host's provider-level approvalDefaults (#302) — an
  //   app-level trust judgment. Guests inherit neither seed (a share-link
  //   visitor is not the operator either trust judgment covers).
  // - `runArmed`: the ACTIVE run was created with
  //   spec.auto_approve_all, so the switch reflects an armed in-flight run —
  //   this is what carries the state across the new-session → session-page
  //   handoff. Deliberately derived from the active run ONLY, never
  //   from history: deriving from past runs would silently survive a
  //   reload independent of the seeds above.
  //
  // The explicit choice lives only in memory for the life of this page —
  // reset on reload re-applies the seeds (the account preference now being
  // the persisted one the user actually declared), never a per-session flip.
  const approvalDefaults = useApprovalDefaults();
  const [autoApproveChoice, setAutoApproveChoice] = useState<boolean | null>(null);
  const accountSeed = !isGuest && (options.accountDefaults?.autoApprove ?? false);
  const hostSeed = !isGuest && (approvalDefaults?.autoApproveAll ?? false);
  const runArmed = conv.activeStreamRun?.spec?.autoApproveAll === true;
  const autoApproveAll = autoApproveChoice ?? (accountSeed || hostSeed || runArmed);
  const setAutoApproveAll = useCallback((value: boolean) => {
    setAutoApproveChoice(value);
  }, []);

  const submitApproval = useCallback<UseSessionConversationReturn["submitApproval"]>(
    async (toolCallId, action, comment) => {
      // "Approve & don't ask again": remember the choice for the rest of this
      // live session so future follow-ups carry auto_approve_all. The control
      // plane separately resolves the current run's remaining gates and
      // the runner skips the gate for the rest of that run.
      if (action === ApprovalAction.APPROVE_ALL) {
        setAutoApproveChoice(true);
      }
      await conv.submitApproval(toolCallId, action, comment);
    },
    [conv.submitApproval],
  );

  // Armed responder (#816, the walk-away scenario): while auto-approve is ON,
  // answer each approval gate as it appears in the in-flight run. This must be
  // a standing responder, not a flip-time one-shot: a gate-time APPROVE_ALL
  // grants a lease scoped to ONE tool class (see APPROVAL_ACTION_APPROVE_ALL
  // in agentexecution enum.proto), so a later gate of a different class would
  // still park the run — the responder covers each class as it surfaces, and
  // every released call keeps an honest audit decision.
  //
  // Read-only surfaces must never auto-submit approvals on a viewer's behalf:
  // the predicate mirrors SessionViewer's read-only derivation (guest audience,
  // observer audience, channel-origin session) exactly.
  const canRespondToGates =
    !isGuest &&
    options.audience !== "observer" &&
    !isChannelOriginSession(conv.session);
  const respondedToolCallIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoApproveAll || !canRespondToGates) return;
    for (const approval of conv.pendingApprovals) {
      const toolCallId = approval.toolCallId;
      // Marked before the submit resolves so a re-render mid-flight cannot
      // double-submit. A failed submission is deliberately NOT retried — the
      // approval card stays for a manual decision instead of a retry storm.
      if (!toolCallId || respondedToolCallIds.current.has(toolCallId)) continue;
      respondedToolCallIds.current.add(toolCallId);
      void conv.submitApproval(toolCallId, ApprovalAction.APPROVE_ALL).catch(() => {
        // Swallowed by design (see above); the card's own error surface
        // reports the failure where the user can act on it.
      });
    }
  }, [autoApproveAll, canRespondToGates, conv.pendingApprovals, conv.submitApproval]);

  // -------------------------------------------------------------------------
  // Agent — derive from session, allow mid-session changes
  // -------------------------------------------------------------------------

  // The agent the session names, read from its spec. `undefined` while the
  // session has not loaded; `null` once it has and names no agent (the
  // built-in assistant).
  const sessionAgentRef = useMemo(
    () => (conv.session ? agentRefOfSession(conv.session) : undefined),
    [conv.session],
  );
  const agentVersion = useSessionAgentVersion(conv.session, {
    enabled: !isGuest,
    moveToCurrentVersion: conv.moveToCurrentAgentVersion,
  });

  const [agentRef, setAgentRefState] = useState<ResourceRef | null>(null);
  const [resolution, setResolutionState] = useState<AgentResolution | null>(null);
  // The user dropped the session's agent and no follow-up has carried the
  // clear to the server yet. Distinguishes "no agent selected because the
  // person removed it" from "no agent selected because the session has
  // none", so only the first sends an override.
  const [agentCleared, setAgentCleared] = useState(false);
  const [agentInitDone, setAgentInitDone] = useState(false);

  // Seed the selection from the session once it is known: its agent when
  // it names one, nothing when it runs the built-in assistant. Runs once,
  // so a later pick or clear by the person is never overwritten by a
  // derived ref arriving after the fact. Guests are never seeded: their
  // composer has no agent machinery, and a follow-up of theirs carries no
  // override, so it continues on the session's own agent and pin.
  if (!agentInitDone && !isGuest && sessionAgentRef !== undefined) {
    setAgentInitDone(true);
    if (sessionAgentRef !== null) {
      setAgentRefState(sessionAgentRef);
      setResolutionState({ mode: "direct" });
    }
  }

  const clearAgent = useCallback(() => {
    setAgentRefState(null);
    setResolutionState(null);
    setAgentCleared(true);
  }, []);
  // A `null` ref is the drop, whichever surface it arrives from: the setup
  // tab calls `clearAgent`, the composer's agent picker deselects through
  // `setAgentRef(null)`. One implementation for one act, so the two
  // surfaces cannot disagree about what the next follow-up carries.
  const setAgentRef = useCallback((ref: ResourceRef | null) => {
    if (ref === null) {
      clearAgent();
      return;
    }
    setAgentRefState(ref);
    setAgentCleared(false);
  }, [clearAgent]);
  const setResolution = useCallback((r: AgentResolution | null) => {
    setResolutionState(r);
    if (r !== null) setAgentCleared(false);
  }, []);

  // -------------------------------------------------------------------------
  // Model — the agent's run defaults, then the person's own picks
  // -------------------------------------------------------------------------

  // The agent the next message runs, at the version it runs: the session's
  // pinned version while the selection is the session's own agent, the
  // current version of an agent the person switched to (the follow-up
  // rebinds the session, which pins that agent's current version).
  // Guests read nothing: a guest token cannot read the agent.
  const nextRunsSessionAgent = agentRef !== null && isSameAgent(agentRef, sessionAgentRef);
  const { spec: runAgentSpec } = useRunAgentSpec(
    isGuest ? null : agentRef,
    nextRunsSessionAgent ? (conv.session?.status?.agentVersionHash ?? "") : "",
  );
  const agentRunDefaults = useMemo(
    () => agentRunDefaultsFor(runAgentSpec, harness),
    [runAgentSpec, harness],
  );

  // Where the agent names a model for this engine, only this conversation's
  // own last pick seeds the composer: a model remembered on this device was
  // picked for other conversations, and sending it would override the
  // agent's default the person never touched here.
  // The person chose the agent's default back in the picker: the last
  // pick no longer seeds the composer or the send until they pick again.
  const [modelPickCleared, setModelPickCleared] = useState(false);
  const modelId = agentRunDefaults
    ? (modelPickCleared ? undefined : lastRequestedModelId)
    : (persistedModelId ?? lastRequestedModelId);
  const setModelId = useCallback(
    (id: string) => {
      setModelPickCleared(false);
      setPersistedModelId(id);
    },
    [setPersistedModelId],
  );
  const clearModelPick = useCallback(() => setModelPickCleared(true), []);
  const model: UsePersistedModelReturn = [modelId, setModelId] as const;

  // -------------------------------------------------------------------------
  // Session spec sync — hydrate workspace, MCP servers, and skills on first load
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!conv.session || initialSyncDone.current) return;
    initialSyncDone.current = true;

    const spec = conv.session.spec;

    // Workspace entries, each git repository under its stored name: a
    // follow-up that rewrites the workspace keeps a repository's stored
    // token only for the same name and URL (see sendFollowUp).
    const protoEntries = spec?.workspaceEntries ?? [];
    for (const entry of protoEntries) {
      if (entry.source?.source.case === "gitRepo") {
        const { url, branch } = entry.source.source.value;
        workspace.addGitRepo(url, branch || undefined, entry.name || undefined);
      } else if (entry.source?.source.case === "localPath") {
        workspace.addLocalPath(entry.source.source.value.path);
      }
    }

    // MCP server usages and skill references, hydrated through the SDK's
    // complete update-input mapper (the canonical proto → input lens).
    const mapped = toSessionUpdateInput(conv.session);
    if (mapped.mcpServerUsages?.length) {
      setMcpServerUsages(mapped.mcpServerUsages);
    }
    if (mapped.skillRefs?.length) {
      setSkillRefs(mapped.skillRefs);
    }
  }, [conv.session, workspace]);

  // -------------------------------------------------------------------------
  // Follow-up submission with agent override
  // -------------------------------------------------------------------------

  const [submitError, setSubmitError] = useState<Error | null>(null);

  const handleSubmit = useCallback(
    async (
      message: string,
      selectedModel?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      setSubmitError(null);

      // Pre-send work runs before conv.sendFollowUp so a failure here
      // aborts cleanly: no optimistic pending message, no session
      // mutation. The composer fires this handler without awaiting it,
      // so a rejection would otherwise be an unhandled rejection —
      // failures must land in submitError instead.
      //
      // The agent override is tri-state: `undefined` leaves the session's
      // agent and its pinned version alone; a reference rebinds the session
      // to that agent (no version, so the server pins its current one);
      // `null` clears it to the built-in assistant.
      let agentRefOverride: ResourceRef | null | undefined;
      let secrets: SessionComposerSubmitContext["secrets"];

      try {
        if (resolution && agentRef) {
          if (!isSameAgent(agentRef, sessionAgentRef)) {
            agentRefOverride = { org: agentRef.org, slug: agentRef.slug };
          }
        } else if (agentCleared && sessionAgentRef) {
          agentRefOverride = null;
        }

        // Evaluated per follow-up so short-lived host credentials are
        // current; host values win over composer-collected values. A guest
        // sends none: the values are written to the conversation, a write
        // a share-link guest may not make, and a guest brings no values
        // anyway (the share's vaults are what its runs use).
        if (!isGuest) {
          secrets = getSessionSecrets
            ? await resolveSessionSecrets(getSessionSecrets, context?.secrets)
            : context?.secrets;
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      conv.sendFollowUp(message, {
        agentRef: agentRefOverride,
        // The owner pin wins over everything the user or the SDK
        // resolved (#664), its tier and thinking as the surface set them.
        // Otherwise the composer's context carries only what the person
        // chose: an untouched tier or thinking stays off the wire, so the
        // layer that chose the model (the agent's defaults, the operator
        // profile) keeps its own.
        modelName: pinnedModelName ?? selectedModel ?? modelId,
        workspaceEntries: workspace.hasEntries
          ? workspace.toInput()
          : undefined,
        mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
        skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
        secrets,
        vaults: context?.vaults,
        attachments: context?.attachments,
        interactionMode: context?.interactionMode,
        serviceTier: pinnedModelName ? pinnedServiceTier : context?.serviceTier,
        thinkingMode: pinnedModelName ? pinnedThinkingMode : context?.thinkingMode,
        buildFromPlan: context?.buildFromPlan,
        // Sourced from the session-scoped preference set at the approval gate,
        // not from the composer (the pre-arm toggle was removed).
        autoApproveAll: autoApproveAll || undefined,
        workspaceFileRefs: context?.workspaceFileRefs,
        supersedesRunId: context?.supersedesRunId,
      });

      sessionVariables.clear();
    },
    [conv.sendFollowUp, modelId, pinnedModelName, pinnedServiceTier, pinnedThinkingMode, workspace, mcpServerUsages, skillRefs, sessionVariables.clear, resolution, agentRef, agentCleared, sessionAgentRef, autoApproveAll, getSessionSecrets, isGuest],
  );

  // -------------------------------------------------------------------------
  // Derived display state
  // -------------------------------------------------------------------------

  const displayRun = useMemo(() => {
    if (conv.activeStreamRun) return conv.activeStreamRun;
    const completed = conv.completedRuns;
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [conv.activeStreamRun, conv.completedRuns]);

  const allRuns = useMemo(
    () => [
      ...conv.completedRuns,
      ...(conv.activeStreamRun ? [conv.activeStreamRun] : []),
    ],
    [conv.completedRuns, conv.activeStreamRun],
  );

  const sandboxWorkspaceRoot = useMemo(() => {
    const entries = conv.workspaceEntries;
    const hasGitRepo = entries.some(
      (e) => e.source?.source.case === "gitRepo",
    );
    return hasGitRepo ? DAYTONA_WORKSPACE_ROOT : undefined;
  }, [conv.workspaceEntries]);

  return {
    conv,
    harness,
    executionTarget,
    model,
    agentRunDefaults,
    clearModelPick,
    interactionMode,
    agentRef,
    setAgentRef,
    resolution,
    setResolution,
    clearAgent,
    agentVersion,
    mcpServerUsages,
    setMcpServerUsages,
    skillRefs,
    setSkillRefs,
    workspace,
    sessionVariables,
    autoApproveAll,
    setAutoApproveAll,
    submitApproval,
    handleSubmit,
    submitError,
    displayRun,
    allRuns,
    sandboxWorkspaceRoot,
  };
}
