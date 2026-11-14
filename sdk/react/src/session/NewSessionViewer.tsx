"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { ResourceRef } from "@stigmer/client";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection.js";
import type { InteractionModeOption } from "../composer/index.js";
import { SessionComposer, type SessionComposerProps } from "../composer/index.js";
import type { HarnessOption } from "@stigmer/react-core";
import type { AccountExecutionDefaults } from "../identity-account/useAccountExecutionDefaults.js";
import { SessionViewerLayout } from "./SessionViewerLayout.js";
import { SessionInspectorContext } from "./inspector/SessionInspectorContext.js";
import type { SessionInspectorProps } from "./inspector/SessionInspector.js";
import { runSettingsRow } from "./run-settings.js";
import { useNewSessionFlow } from "./useNewSessionFlow.js";
import { useOrgIdForRef } from "../organization/useOrgRefs.js";
import { useSessionPanel } from "./useSessionPanel.js";
import { SessionPanelChip } from "./SessionPanelChip.js";
import { AutoApproveIndicator } from "./AutoApproveIndicator.js";
import { includesMyVaultByDefault, type SessionAudience } from "./audience.js";
import type { SessionRunConfig } from "./run-config.js";
import { agentHoursUsedUp, DEFAULT_MODELS_HUB_HREF, providerKeyRequired } from "../billing/refusals.js";
import {
  ConnectProviderPanel,
  connectReason,
  keyUnchecked,
  KeySavedUncheckedNote,
  ModelNeedsProvider,
} from "../models/ConnectProvider.js";
import { useModelsHubData } from "../models/hub/ModelsHub.js";
import { nothingRuns } from "../models/readiness.js";
import { useModelRegistry } from "../models/useModelRegistry.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { useFirstQuestionGate } from "./first-question/useFirstQuestionGate.js";
import type { SessionLaunch } from "./launch.js";
import type { JourneyLinks } from "../journey/links.js";
import { useStartFromExample, type FirstChoice } from "./first-question/useStartFromExample.js";
// The first question and its chosen bar, with the example list they carry,
// load only when a launcher shows them: an embed or a returning person never
// downloads them.
const FirstQuestion = lazy(() => import("./first-question/FirstQuestion.js").then((m) => ({ default: m.FirstQuestion })));
const ChosenBar = lazy(() => import("./first-question/FirstQuestion.js").then((m) => ({ default: m.ChosenBar })));
// The journey's next line, and the reads behind it, load only for a host that
// passes `journeyLinks`: an embed never downloads them.
// The refusal notices load only when a refusal arrives: the launcher's first
// draw carries the check, not the notice.
const ProviderKeyNotice = lazy(() => import("../billing/ProviderKeyNotice.js").then((m) => ({ default: m.ProviderKeyNotice })));
const AgentHoursNotice = lazy(() => import("../billing/AgentHoursNotice.js").then((m) => ({ default: m.AgentHoursNotice })));
const JourneyLauncherLine = lazy(() => import("../journey/JourneyNextLine.js").then((m) => ({ default: m.JourneyLauncherLine })));

/** What an end user reads when the agent their launcher is pinned to cannot be found. */
const PIN_UNAVAILABLE = "This agent isn't available. It may have been renamed or removed.";

/** Props for {@link NewSessionViewer}. */
export interface NewSessionViewerProps {
  /** Organization id (a slug is also accepted). Required for session creation. */
  readonly org: string;
  /** Called after the session and first run are created. */
  readonly onSessionCreated: (sessionId: string) => void;
  /**
   * Called on error (for toast notifications or other UI feedback), with
   * the message and the error itself. A refusal the launcher already shows
   * in place (a `PROVIDER_KEY_REQUIRED` one, through `providerKeyRequired`)
   * is the host's to skip, so it shows once.
   */
  readonly onError?: (message: string, error: Error) => void;

  /**
   * GitHub connection state for the workspace repo picker.
   * Platform-specific — web passes `useGitHubConnection(org)`,
   * desktop omits it.
   */
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  /** Whether to enable GitHub workspace sources. @default true */
  readonly enableGitHub?: boolean;
  /** Whether to enable local workspace sources. @default false */
  readonly enableLocal?: boolean;
  /**
   * Native folder picker callback for desktop environments.
   * Desktop supplies this via Tauri's dialog plugin.
   */
  readonly onBrowseLocalFolder?: () => Promise<string | null>;

  /**
   * Whether the conversation includes its sender's own My vault, read
   * first, ahead of `vaults`. Each person who sends a turn uses their own
   * My vault, never another's. Defaults to on for the `"integrator"` and
   * `"endUser"` audiences (a signed-in person brings their own keys) and
   * off for `"guest"`. The person may untick it in the composer's vault
   * picker where the audience offers one.
   */
  readonly includeMyVault?: boolean;

  /**
   * Whether the conversation records each turn's file edits so the person
   * can undo them after the turn. The edits apply as they are made either
   * way. Defaults to on for the `"integrator"` audience and off for
   * `"endUser"` and `"guest"` (see `useNewSessionFlow`'s `fileReview`).
   */
  readonly fileReview?: boolean;

  /**
   * Shared vaults the conversation uses, in order (the first holding a
   * key or login wins), after the sender's My vault when it is included.
   * An app that embeds Stigmer names here the vaults its users' chats
   * read, instead of handing keys to each conversation. The person may
   * change them in the composer's vault picker where the audience offers
   * one.
   */
  readonly vaults?: readonly ResourceRef[];

  /**
   * Presentation audience for the launcher. `"endUser"` locks the
   * pinned agent (when `initialAgentRef` is set) and hides the
   * plugin, skill, and vault pickers — for product-embedded
   * chat where the agent is configured upstream by the platform. The
   * model selector, interaction mode, harness selector, file uploads,
   * and workspace picker remain.
   *
   * `"guest"` (anonymous visitor with a guest token) is pure chat: it
   * additionally hides the model/harness/mode pickers, file uploads,
   * the workspace picker, and the session panel, binds the session to
   * `initialAgentRef` (version included) without any picker machinery,
   * and skips the org-level reads a guest principal cannot make.
   * Requires `initialAgentRef` — a guest launcher never falls back to
   * the built-in assistant.
   *
   * See {@link SessionAudience}.
   *
   * @default "integrator"
   */
  readonly audience?: SessionAudience;

  /**
   * Owner-pinned model/tier for the session's first run
   * (stigmer/stigmer#664). Same contract as
   * {@link SessionViewerProps.runConfig}: wins over the
   * composer and the restored preference, hides the model picker, and
   * is ignored for the `"guest"` audience. Pair with the same pin on
   * the conversation's `SessionViewer` so follow-ups match. See
   * {@link SessionRunConfig}.
   */
  readonly runConfig?: SessionRunConfig;

  /**
   * Whether the composer offers the model picker. Same contract as
   * {@link SessionViewerProps.showModelSelector}:
   * forced off by a {@link NewSessionViewerProps.runConfig} model pin
   * and for the `"guest"` audience.
   *
   * @default true
   */
  readonly showModelSelector?: boolean;

  /**
   * Harness pre-selected for new sessions when the user has not made
   * an explicit choice yet. The user can still switch before starting
   * the session, and their explicit choice wins on subsequent visits.
   *
   * @default "stigmer"
   */
  readonly defaultHarness?: HarnessOption;

  /**
   * The user's account-level execution defaults, typically from
   * `useAccountExecutionDefaults()`. Seeds the harness and model pickers
   * under the layered precedence documented on
   * {@link UseNewSessionFlowOptions.accountDefaults}; explicit device
   * picks always win. Ignored for the `"guest"` audience.
   */
  readonly accountDefaults?: AccountExecutionDefaults;

  /**
   * Agent to auto-select on mount (used for draft flows and the agent
   * detail page's "Start session"). The conversation starts on this
   * reference; a version it names is the version the session pins.
   */
  readonly initialAgentRef?: ResourceRef;
  /**
   * Plugins the conversation starts with, read once on mount: a plugin
   * page's "Start a chat" arrives with its plugin here, for a
   * conversation with the assistant that uses it. Ignored for the
   * `"guest"` audience.
   */
  readonly initialPluginRefs?: readonly ResourceRef[];
  /**
   * Remember the person's plugin picks in this browser and start the
   * next new conversation with them, unless `initialPluginRefs` names
   * plugins. See {@link UseNewSessionFlowOptions.rememberPluginPicks}.
   *
   * @default false
   */
  readonly rememberPluginPicks?: boolean;
  /** Files to auto-attach on mount (used for edit flows). */
  readonly initialFiles?: File[];
  /**
   * The message the composer starts with, read once on mount like
   * `initialFiles`: written for the person, who may send it as it is or
   * change it. A later value never replaces what they typed.
   */
  readonly initialMessage?: string;

  /**
   * One launch into the launcher: the agent it starts on and what the
   * composer starts with (files, a written message, a heading and a
   * placeholder). Each new `key` mounts a fresh composer with its own agent,
   * files and message, so a launch into a launcher that stayed mounted
   * while a session was open is never mixed with the one before. Spent once
   * its session is created: the launcher then shows its usual composer. A
   * launch sends the person somewhere, so the first question is not shown.
   * The agent page's "Make it yours" tab arrives here (`useLinkedLaunch`
   * reads its link; `exampleLaunch` builds one from an example). Ignored
   * for the `"guest"` audience.
   */
  readonly launch?: SessionLaunch;

  /**
   * Open on the first question for a newcomer: in an organization where
   * nothing has ever run, a person the server lets make agents is asked
   * what their agent should do for their users, with example jobs (from
   * `@stigmer/examples`), a way to describe their own and a way to just
   * chat. A pick makes the agent and puts it, its sample files and its
   * first message in the composer; the key step comes first when nothing
   * can run yet. It ends once that launcher's first session is created.
   * Never shown to a guest, to a curated audience, or when
   * `initialAgentRef` or `initialPluginRefs` sends the person to a specific
   * agent or plugin. Off unless
   * the host asks, so an app embedding the launcher never shows Stigmer's
   * own onboarding. @default false
   */
  readonly firstQuestion?: boolean;

  /**
   * Where the journey's later steps lead, in the host's routing. With
   * `firstQuestion` on, a launcher whose first state has ended names the
   * journey's next step in one quiet line under its heading, from "Make it
   * yours" on ("Next: make Variance Reporter yours"), linking there. Not
   * shown while a launch or a deep link sends the person somewhere.
   */
  readonly journeyLinks?: JourneyLinks;

  /** Heading text above the composer. @default "What would you like to work on?" */
  readonly heading?: string;
  /** Placeholder for the composer textarea. */
  readonly placeholder?: string;
  /** Initial number of visible textarea rows. @default 3 */
  readonly initialRows?: number;
  /** Auto-focus the textarea on mount. @default true */
  readonly autoFocus?: boolean;

  /**
   * Slot for host-injected actions rendered below the composer
   * (e.g., submit error messages). Keeps the SDK organism unopinionated
   * about Console-specific error rendering.
   */
  readonly footerContent?: ReactNode;

  /**
   * Where Models & providers is, in the host's routing: the launcher's
   * connect step and its notices link there. Defaults to
   * {@link DEFAULT_MODELS_HUB_HREF}.
   */
  readonly modelsHubHref?: string;

  /**
   * The builder mode: the attached workspaces' explorer and editor beside
   * the composer, with the chip that opens it. The console and the desktop
   * app pass `<SessionInspector />`; an embed passes nothing and ships none
   * of its code. Never shown to a guest.
   */
  readonly inspector?: ReactElement<SessionInspectorProps>;

  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Full-featured new-session launcher organism — the pre-session analog
 * of `SessionViewer`.
 *
 * Owns `useNewSessionFlow` internally and composes:
 * - **Centered composer** (primary pane): `SessionComposer` with all
 *   context pickers (agent, workspace, plugins, skills)
 * - **Inspector** (secondary pane, when the host passes `inspector`): the
 *   attached workspaces' explorer and editor, collapsed behind a top-right
 *   chip. How the first turn runs is in the composer's run settings. Same
 *   layout model as `SessionViewer`.
 *
 * Framework-agnostic — no Next.js, no Tauri, no routing deps. Host
 * apps inject platform-specific values via props.
 *
 * @example
 * ```tsx
 * function NewConversationPage({ org, onOpen }: { org: string; onOpen: (sessionId: string) => void }) {
 *   const gitHub = useGitHubConnection(org);
 *   return (
 *     <NewSessionViewer
 *       org={org}
 *       onSessionCreated={onOpen}
 *       onError={(msg) => toast.error(msg)}
 *       enableGitHub
 *       gitHubConnection={gitHub}
 *     />
 *   );
 * }
 * ```
 */
export function NewSessionViewer({
  org,
  onSessionCreated,
  onError,
  gitHubConnection,
  enableGitHub = true,
  enableLocal = false,
  onBrowseLocalFolder,
  includeMyVault,
  fileReview,
  vaults,
  audience = "integrator",
  runConfig,
  showModelSelector = true,
  inspector,
  defaultHarness,
  accountDefaults,
  initialAgentRef,
  initialPluginRefs,
  rememberPluginPicks,
  initialFiles,
  initialMessage,
  launch,
  firstQuestion = false,
  journeyLinks,
  heading = "What would you like to work on?",
  placeholder = "Describe what you need help with\u2026",
  initialRows = 3,
  autoFocus = true,
  footerContent,
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
  className,
}: NewSessionViewerProps) {
  const [pinError, setPinError] = useState<Error | null>(null);
  const includesMyVault = includeMyVault ?? includesMyVaultByDefault(audience);
  // The first question ends for good in this launcher once it is left
  // ("Just chat") or its session is created: the hosts keep the launcher
  // mounted while a session is open, so it must not come back on return
  // while "has anything run" has not been read again.
  const [firstDone, setFirstDone] = useState(false);
  const [choice, setChoice] = useState<FirstChoice | null>(null);
  // Each organization is asked afresh: another organization's "Just chat" or
  // unsent pick never carries over.
  const [firstOrg, setFirstOrg] = useState(org);
  const orgChanged = firstOrg !== org;
  // A launch is spent once its session is created: the launcher, still
  // mounted while the session is open, shows its usual composer on return.
  const [spentLaunchKey, setSpentLaunchKey] = useState<string | null>(null);
  const activeLaunch = launch !== undefined && audience !== "guest" && launch.key !== spentLaunchKey ? launch : undefined;
  const activeLaunchKey = activeLaunch?.key;
  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setFirstDone(true);
      setChoice(null);
      if (activeLaunchKey !== undefined) setSpentLaunchKey(activeLaunchKey);
      onSessionCreated(sessionId);
    },
    [onSessionCreated, activeLaunchKey],
  );
  const flow = useNewSessionFlow({
    org,
    onSessionCreated: handleSessionCreated,
    onError,
    includeMyVault: includesMyVault,
    fileReview,
    vaults,
    defaultHarness,
    accountDefaults,
    audience,
    runConfig,
    initialPluginRefs,
    rememberPluginPicks,
  });
  const [interactionMode, setInteractionMode] = useState<InteractionModeOption>("agent");
  const isGuest = audience === "guest";
  // A deep link wins: a person sent to a specific agent, or to chat with a
  // plugin (a plugin page's "Start a chat"), never meets the question.
  // Neither does a guest or a curated audience.
  const sentSomewhere = initialAgentRef != null || (initialPluginRefs?.length ?? 0) > 0 || activeLaunch !== undefined;
  const firstGate = useFirstQuestionGate(org, firstQuestion && audience === "integrator" && !sentSomewhere);
  const firstOpen = !firstDone && firstGate === "ask";
  const firstWaits = !firstDone && firstGate === "pending";
  const starts = useStartFromExample(org);
  // A reference may name its org by slug (one a host or URL supplied) or by
  // id (a stored or picked one), so both sides are compared by id.
  const orgIdFor = useOrgIdForRef();

  // Readiness before Send. The launcher judges the (engine, model) its
  // picker shows: the person's pick, else the agent's run default, else the
  // engine's default. Nothing runs anywhere: the connect step takes the
  // composer's place. Only the shown model is missing: one line above the
  // composer, and Send held with its reason. Unknown never blocks, and a
  // guest (who cannot ask) is never judged; the server's refusal at create
  // stays the backstop, rendered once as the notice below.
  const hub = useModelsHubData(isGuest ? null : orgIdFor(org));
  const engineRegistry = useModelRegistry({ harness: flow.harness });
  const engineDefaultId = engineRegistry.defaultModel?.modelId ?? "";
  const shownModelId = runConfig?.modelName ?? (flow.modelId || flow.agentRunDefaults?.modelName || engineDefaultId);
  const shownModelName = engineRegistry.getModel(shownModelId)?.displayName || shownModelId;
  const shownReadiness = shownModelId === "" ? undefined : hub.readinessOf(flow.harness, shownModelId);
  const shownMissing = shownReadiness !== undefined && shownReadiness.availability.state === "missing";
  const connectProvider =
    (shownMissing ? shownReadiness.provider : undefined) ??
    hub.readinessOf(flow.harness, engineDefaultId)?.provider ??
    hub.providers?.find((report) => report.availability.state === "missing")?.provider;
  const showConnectPanel =
    // Chosen on readiness alone, which answers first: the composer is never
    // drawn and then swapped for the connect step under someone's typing
    // (stigmer#2699). Only the step's own content waits for the permission.
    !isGuest && !hub.readinessLoading && nothingRuns(hub.models) && connectProvider !== undefined && connectProvider !== "";
  // A key saved on this screen whose check the provider did not answer is
  // said once, above the composer that comes back; a later visit, or a key
  // the provider checked, says nothing here (the card keeps saying it).
  const [keySaved, setKeySaved] = useState<{ readonly org: string; readonly provider: string } | null>(null);
  const noteKeyUnchecked =
    keySaved !== null &&
    keySaved.org === hub.org &&
    !showConnectPanel &&
    keyUnchecked(hub, keySaved.provider);
  const keyUncheckedNote = noteKeyUnchecked ? <KeySavedUncheckedNote provider={keySaved.provider} /> : null;
  const onKeySaved =
    connectProvider === undefined ? undefined : () => setKeySaved({ org: hub.org, provider: connectProvider });
  // An end user's launcher pinned to an agent never sends without it
  // (stigmer#2748): Send waits while the pin resolves, and a pin that cannot
  // resolve says so here, where the locked composer's own agent panel is
  // never opened.
  const pinsAgent = audience === "endUser" && initialAgentRef != null;
  const pinWaits = pinsAgent && flow.agentRef == null;
  const sendBlockedReason = pinWaits
    ? pinError !== null
      ? PIN_UNAVAILABLE
      : "Loading the agent\u2026"
    : !showConnectPanel && shownMissing
      ? connectReason(shownReadiness.provider, shownModelName)
      : undefined;
  // A pinned model makes the picker a dead control (the pin wins over any
  // choice it could offer), so the pin forces it hidden; the guest strip
  // and the host's explicit opt-out compose with it (the same rule as
  // SessionViewer).
  const modelSelectorVisible =
    showModelSelector && !isGuest && runConfig?.modelName === undefined;
  // Both curated audiences (endUser, guest) lock the agent and hide the
  // integrator pickers; guest adds its own restrictions below.
  const isCurated = audience !== "integrator";
  // Host opt-out or audience restriction — the same single flag
  // SessionViewer derives, gating the chip and the region together.
  const panelEnabled = inspector !== undefined && !isGuest;
  const inspectorProps = inspector?.props;

  // Guest agent binding is host configuration, not a picker interaction:
  // the composer's agent machinery (picker, env-collection, vaults —
  // all org reads a guest token cannot make) stays fully
  // unwired, and the launcher pins the flow to the chat link's agent's
  // reference directly. Without the pin, submission fails closed in
  // useNewSessionFlow rather than falling back to the built-in assistant.
  const { setAgentRef, setResolution } = flow;
  if (orgChanged) {
    // Set during render, as React allows for a component's own state, so no
    // frame shows the other organization's choice.
    setFirstOrg(org);
    setFirstDone(false);
    if (choice !== null) {
      setChoice(null);
      setAgentRef(null);
      setResolution(null);
    }
  }
  useEffect(() => {
    if (!isGuest || !initialAgentRef) return;
    setAgentRef(initialAgentRef);
    setResolution({ mode: "direct" });
  }, [isGuest, initialAgentRef, setAgentRef, setResolution]);

  // Leaving a pick (back to the cards, or to plain chat) clears the agent
  // it selected, so the next composer starts from the person's own choice;
  // the agent itself stays made.
  const clearPickedAgent = useCallback(() => {
    setAgentRef(null);
    setResolution(null);
  }, [setAgentRef, setResolution]);
  const leaveFirst = useCallback(() => {
    clearPickedAgent();
    setChoice(null);
    starts.clearFailure();
    setFirstDone(true);
  }, [clearPickedAgent, starts]);
  const changeChoice = useCallback(() => {
    clearPickedAgent();
    setChoice(null);
  }, [clearPickedAgent]);
  const { pickExample, describeOwn } = starts;
  const pick = useCallback(
    (made: Promise<FirstChoice | null>) => {
      void made.then((next) => {
        if (next !== null) setChoice(next);
      });
    },
    [],
  );
  // A pick lands the person on what was made: the chosen bar takes focus
  // when it appears, and the live region below says it.
  const choiceFiles = useMemo(() => (choice === null ? undefined : [...choice.files]), [choice]);
  const launchFiles = useMemo(() => (activeLaunch?.files === undefined ? undefined : [...activeLaunch.files]), [activeLaunch]);
  // The journey's next step, under the plain launcher's heading, once its
  // first state has ended and nothing sends the person somewhere.
  const namesNextStep =
    firstQuestion && journeyLinks !== undefined && audience === "integrator" && !sentSomewhere && !firstOpen && !firstWaits;

  // The unified-panel controller (shared with SessionViewer). The
  // launcher has no run yet, so the FSM inputs are static; the inspector
  // region subscribes to the editor group, as SessionViewer's does.
  const panel = useSessionPanel({
    phase: null,
    hasChanges: false,
    // Same inertness contract as SessionViewer: a disabled panel is pinned
    // controlled-closed and unobserved.
    open: panelEnabled ? inspectorProps?.open : false,
    defaultOpen: inspectorProps?.defaultOpen,
    onOpenChange: panelEnabled ? inspectorProps?.onOpenChange : undefined,
  });

  // How the first turn runs, in the composer's configure menu. Never a
  // guest's: the share policy owns a guest's run.
  const runSettings = useMemo(
    () =>
      isGuest
        ? undefined
        : [
            runSettingsRow({
              harness: flow.harness,
              executionTarget: undefined,
              modelId: flow.modelId,
              environment: undefined,
              autoApprove: { armed: flow.autoApproveAll, onChange: flow.setAutoApproveAll },
              curated: isCurated,
            }),
          ],
    [isGuest, isCurated, flow.harness, flow.modelId, flow.autoApproveAll, flow.setAutoApproveAll],
  );

  const composerProps: SessionComposerProps = {
      extraSettings: runSettings,
      sendBlockedReason,
      modelReadinessOf: isGuest ? undefined : hub.readinessOf,
      onSubmit: flow.submit,
      isSubmitting: flow.isSubmitting,
      org,
      workspace: isGuest ? undefined : flow.workspace,
      gitHubConnection: enableGitHub && !isGuest ? gitHubConnection : undefined,
      enableGitHub: enableGitHub && !isGuest,
      enableLocal: enableLocal && !isGuest,
      onBrowseLocalFolder,
      agentRef: flow.agentRef,
      // Guests get no agent machinery at all — the binding is applied
      // by the launcher's pin effect above, not by picker resolution.
      onAgentRefChange: isGuest ? undefined : flow.setAgentRef,
      onAgentResolutionChange: isGuest ? undefined : flow.setResolution,
      initialAgentRef: isGuest ? undefined : initialAgentRef,
      onAgentSetupErrorChange: pinsAgent ? setPinError : undefined,
      // Every message here starts a conversation, so the keys the
      // selected agent will read from the person's My vault are named
      // first. A guest has no vault, and brings none.
      disclosePersonalKeys: !isGuest,
      enableVaultPicker: !isGuest && !isCurated,
      initialIncludeMyVault: includesMyVault,
      initialVaultRefs: vaults,
      // The Environment is the new conversation's to pick, beside its
      // vaults; the flow says where it applies at all.
      enableEnvironmentPicker: flow.offersEnvironment && !isCurated,
      environmentDefaults: flow.environmentDefaults,
      initialFiles: isGuest ? undefined : initialFiles,
      lockAgent: isCurated && initialAgentRef != null,
      pluginRefs: isCurated ? undefined : flow.pluginRefs,
      onPluginRefsChange: isCurated ? undefined : flow.setPluginRefs,
      skillRefs: isCurated ? undefined : flow.skillRefs,
      onSkillRefsChange: isCurated ? undefined : flow.setSkillRefs,
      showHarnessSelector: !isGuest,
      harness: flow.harness,
      onHarnessChange: flow.setHarness,
      interactionMode,
      onInteractionModeChange: setInteractionMode,
      showInteractionModePicker: !isGuest,
      showModelSelector: modelSelectorVisible,
      enableFiles: !isGuest,
      defaultModelId: flow.modelId,
      agentRunDefaults: flow.agentRunDefaults,
      onModelChange: flow.setModelId,
      onModelPickCleared: flow.clearModelPick,
      placeholder,
      initialRows,
      // The composer appears once readiness answers, which can be after
      // the person has moved focus elsewhere; it takes focus only from
      // the page itself, never from what they chose.
      autoFocus: autoFocus && focusIsFree(),
      ariaLabel: "Start a new session",
  };

  const composerNode = (
    // `my-auto` centers the composer vertically whether or not context is
    // attached — safe-centering, not a special case: auto margins absorb free
    // space when the composer is shorter than the pane and collapse to zero
    // when it outgrows it, degrading to a normal top-aligned scroll. The
    // scroll container's `py-6` keeps breathing room in that overflow case.
    // Do NOT reintroduce a context-driven position flip: the composer must not
    // move as context is attached (layout stability — chrome
    // that shifts with attached context reads as instability).
    <div className="stg:flex stg:h-full stg:flex-col stg:items-center stg:overflow-y-auto stg:px-4 stg:py-6">
      <div
        className={
          firstOpen
            ? // The first state is a reading-width column whose parts sit closer.
              "stg:my-auto stg:w-full stg:max-w-[760px] stg:space-y-4"
            : "stg:my-auto stg:w-full stg:max-w-2xl stg:space-y-6"
        }
      >
        {!isGuest && (hub.readinessLoading || firstWaits) ? (
          // What can run, or whether this is a newcomer's first visit, is
          // not known yet: hold the place rather than draw a composer the
          // connect step or the first question might replace under
          // someone's typing.
          <LoadingRegion label="Loading" className="stg:h-36 stg:animate-pulse stg:rounded-2xl stg:bg-muted" />
        ) : firstOpen && choice === null ? (
          <Suspense fallback={FIRST_LOADING}>
            <FirstQuestion
              pending={starts.pending}
              failure={starts.failure}
              onPick={(example) => pick(pickExample(example))}
              onDescribe={(words) => pick(describeOwn(words))}
              onJustChat={leaveFirst}
            />
          </Suspense>
        ) : firstOpen && choice !== null ? (
          <>
            <div className="stg:text-center">
              <h1 className="stg:m-0 stg:text-xl stg:font-semibold stg:tracking-tight stg:text-balance stg:text-foreground">
                {showConnectPanel ? "One more thing before it runs" : choice.example ? "Send it the sample" : "Give it a first job"}
              </h1>
              {/* While the key step shows, its own lead says why a model is
                  needed, and the chosen bar below says what was made. */}
              {!showConnectPanel && (
                <p className="stg:mx-auto stg:mt-1.5 stg:mb-0 stg:max-w-[60ch] stg:text-sm stg:leading-5 stg:text-muted-foreground">
                  {choice.example
                    ? `The message is written and the ${choice.example.sampleName} ${choice.example.samples.length > 1 ? "are" : "is"} attached. Send it and watch the agent work.`
                    : "Attach one of your own files and say what you need."}
                </p>
              )}
            </div>
            <Suspense fallback={null}>
              <ChosenBar choice={choice} onChange={changeChoice} />
            </Suspense>
            {showConnectPanel ? (
              <ConnectProviderPanel
                hub={hub}
                harness={flow.harness}
                provider={connectProvider}
                modelName={shownModelName}
                modelsHubHref={modelsHubHref}
                showHeading={false}
                onKeySaved={onKeySaved}
              />
            ) : (
              <>
              {keyUncheckedNote}
              <SessionComposer
                // A new pick mounts a new composer: its agent, files and
                // message are read once, when it mounts.
                key={`${choice.agentRef.org}/${choice.agentRef.slug}`}
                {...composerProps}
                initialAgentRef={choice.agentRef}
                initialFiles={choiceFiles}
                initialMessage={choice.message}
                placeholder={choice.example ? placeholder : "Attach one of your own files and say what you need"}
              />
              </>
            )}
          </>
        ) : showConnectPanel ? (
          <ConnectProviderPanel
            hub={hub}
            harness={flow.harness}
            provider={connectProvider}
            modelName={shownModelName}
            modelsHubHref={modelsHubHref}
            onKeySaved={onKeySaved}
          />
        ) : (
          <>
          <h1 className="stg:text-center stg:text-lg stg:font-medium stg:text-foreground">
            {activeLaunch?.heading ?? heading}
          </h1>
          {/* Close under the heading it continues; the column's gap would set it apart. */}
          {journeyLinks !== undefined && (
            <Suspense fallback={null}>
              <JourneyLauncherLine org={org} links={journeyLinks} enabled={namesNextStep} className="stg:-mt-4" />
            </Suspense>
          )}
          {keyUncheckedNote}
          {shownMissing && !hub.isLoading && (
            <ModelNeedsProvider
              hub={hub}
              provider={shownReadiness.provider}
              modelName={shownModelName}
              modelsHubHref={modelsHubHref}
            />
          )}

          {activeLaunch !== undefined ? (
            <SessionComposer
              // A new launch mounts a new composer: its agent, files and
              // message are read once, when it mounts.
              key={activeLaunch.key}
              {...composerProps}
              initialAgentRef={activeLaunch.agentRef}
              initialFiles={launchFiles}
              initialMessage={activeLaunch.message}
              placeholder={activeLaunch.placeholder ?? placeholder}
            />
          ) : (
            <SessionComposer {...composerProps} initialMessage={initialMessage} />
          )}
          </>
        )}

        {firstOpen && (
          <p aria-live="polite" className="stg:sr-only">
            {choice !== null ? `${choice.agentName} is made.` : ""}
          </p>
        )}

        {/* A run refused for want of a provider key says where an admin
            adds one, and one refused because the plan's agent hours are
            used says when they reset and where the plans are; every other
            refusal reaches the host's onError. */}
        {flow.submitFailure !== null && providerKeyRequired(flow.submitFailure) !== null && (
          <Suspense fallback={null}>
            <ProviderKeyNotice error={flow.submitFailure} modelsHubHref={modelsHubHref} />
          </Suspense>
        )}
        {flow.submitFailure !== null && agentHoursUsedUp(flow.submitFailure) !== null && (
          <Suspense fallback={null}>
            <AgentHoursNotice error={flow.submitFailure} />
          </Suspense>
        )}

        {/* Armed-only disclosure (#816 rework): a persisted account preference
            or the host's approvalDefaults can pre-arm the session this surface
            will create — the user must see that before the first send, with
            the one-click way off. Guests never inherit either seed. */}
        {!isGuest && flow.autoApproveAll && (
          <AutoApproveIndicator onTurnOff={() => flow.setAutoApproveAll(false)} />
        )}

        {pinWaits && pinError !== null && (
          <p role="alert" className="stg:text-center stg:text-xs stg:text-destructive">
            {PIN_UNAVAILABLE}
          </p>
        )}

        {footerContent}

        {!showConnectPanel && !(!isGuest && (hub.readinessLoading || firstWaits)) && !(firstOpen && choice === null) && (
          <p className="stg:text-center stg:text-2xs stg:text-muted-foreground">
            Press Enter to send, Shift+Enter for a new line
          </p>
        )}
      </div>
    </div>
  );

  return (
    // The launcher renders the same SessionViewerLayout as SessionViewer
    // — the shared frame is what makes "the two viewers behave
    // identically" structural rather than hand-synchronized.
    <SessionViewerLayout
      className={className}
      resizeAriaLabel="Resize composer panel"
      splitStorageKey="stgm-new-session-chat-width"
      // Persistent chrome: the chip is always mounted, matching SessionViewer
      // rather than the launcher's earlier progressively-revealed
      // inspector. A toggle that appears/disappears with attached context
      // reads as instability and, worse, unmounts the open panel's only
      // collapse control when the last context item is removed. Always-on is
      // the predictable, discoverable shape; opening homes on the Explorer.
      // A viewer without an inspector (an embed, or a guest) gets no chip:
      // the panel's only toggle is simply absent and it can never open.
      chip={
        panelEnabled ? (
          <SessionPanelChip
            isOpen={panel.isOpen}
            onToggle={panel.isOpen ? panel.closePanel : panel.openPanel}
          />
        ) : undefined
      }
      conversation={composerNode}
      panel={
        panel.isOpen && panelEnabled ? (
          <SessionInspectorContext.Provider
            value={{
              kind: "launch",
              scope: {
                workspace: flow.workspace,
                panel,
                onBrowseLocalFolder: enableLocal ? onBrowseLocalFolder : undefined,
              },
            }}
          >
            {inspector}
          </SessionInspectorContext.Provider>
        ) : null
      }
    />
  );
}

/** The place the first question holds while its module loads. */
const FIRST_LOADING = <LoadingRegion label="Loading" className="stg:h-36 stg:animate-pulse stg:rounded-2xl stg:bg-muted" />;

/** Whether nothing on the page holds focus, so a composer that mounts now may take it. */
function focusIsFree(): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement;
  return active === null || active === document.body;
}
