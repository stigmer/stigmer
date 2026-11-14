"use client";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage, type DisplayFileChange, type ResourceRef, type Turn } from "@stigmer/client";
import { isUnreachable } from "../internal/unreachable.js";
import { create } from "@bufbuild/protobuf";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection.js";
import { resolveWorkspaceFileSelection } from "../workspace/resolveWorkspaceFileSelection.js";
import type { InteractionModeOption, SessionComposerHandle, SessionComposerSubmitContext } from "../composer/index.js";
import type { AccountExecutionDefaults } from "../identity-account/useAccountExecutionDefaults.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";
import { SessionViewerLayout } from "./SessionViewerLayout.js";
import { SessionInspectorContext } from "./inspector/SessionInspectorContext.js";
import type { SessionInspectorProps } from "./inspector/SessionInspector.js";
import type { SessionStreamingPlan } from "./inspector/SessionInspectorRegion.js";
import { isTerminalPhase } from "@stigmer/react-core/internal";
import { MessageThread, type MessageThreadSlots } from "../run/MessageThread.js";
import { THREAD_GUTTER_CLASS } from "../internal/thread-gutter.js";
import { useIsNarrowerThan } from "../internal/useIsNarrowerThan.js";
import { FileChangeProgressBar } from "../run/FileChangeProgressBar.js";
import { ThreadSkeleton } from "../run/ThreadSkeleton.js";
import { SessionComposer } from "../composer/index.js";
import { AgentHoursNotice } from "../billing/AgentHoursNotice.js";
import { ChatActivityReporterContext } from "../agent-chat/chat-activity.js";
import { chatActivityOf } from "../agent-chat/chat-activity-of.js";
import { TurnOutcome, type TurnOutcomeUndo } from "./TurnOutcome.js";
import { ComposerStrip } from "./ComposerStrip.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { turnOutcome, type TurnChange } from "./turn-outcome.js";
import { TurnChangeDialog } from "./TurnChangeDialog.js";
import { FilePreviewModal } from "../run/FilePreviewModal.js";
import { deriveRunFileChanges } from "../run/deriveRunFileChanges.js";
import { SessionSummary } from "./SessionSummary.js";
import { CONVERSATION_FILES_VIEW_ID } from "./useSessionRailViews.js";
import { useRunSettings } from "./run-settings.js";
import { ProviderKeyNotice } from "../billing/ProviderKeyNotice.js";
import { agentHoursUsedUp, DEFAULT_MODELS_HUB_HREF, providerKeyRequired } from "../billing/refusals.js";
import { ErrorMessage, SecretFlowErrorGuide, isSecretFlowError } from "../error/index.js";
import { useStigmer } from "@stigmer/react-core";
import { findLatestSessionPlan, planFilesByRun } from "../library/detect-plan-file.js";
import { useSessionFiles } from "../file/useSessionFiles.js";
import { findStreamingPlan } from "../library/detect-streaming-plan.js";
import { useSessionAccess } from "./useSessionAccess.js";
import { useSessionPageFlow } from "./useSessionPageFlow.js";
import { isChannelOriginSession } from "./channelOrigin.js";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { usePlanDraft, planDraftKey } from "./usePlanDraft.js";
import { useSessionPanel } from "./useSessionPanel.js";
import { SessionPanelChip } from "./SessionPanelChip.js";
import { TranscriptExportMenu } from "./TranscriptExportMenu.js";
import { AutoApproveIndicator } from "./AutoApproveIndicator.js";
import { AgentVersionNotice } from "./AgentVersionNotice.js";
import { agentRefOfSession, isSameAgent } from "./agentRefOfSession.js";
import { useTurnEndingWiring, type SessionAgentRef } from "./useTurnEndingWiring.js";
import { useSessionWriteBacks } from "./useSessionWriteBacks.js";
import { useSessionOutputs, outputKey } from "./useSessionOutputs.js";
import { useSessionGivenFiles } from "./useSessionGivenFiles.js";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionAudience } from "./audience.js";
import { showsRunScores } from "./audience.js";
import type { SessionRunConfig } from "./run-config.js";
import { Button } from "../button/Button.js";
import { FailureHelpLine } from "../help/HelpLink.js";

/**
 * The build turn's user message — a short human-readable label, NOT the
 * implement instruction. The agent-facing instruction is runner-injected
 * (keyed off `spec.buildFromPlan`). The thread hides the turn
 * entirely from the same flag (the plan card above it is the visible cause);
 * this label exists for surfaces without that treatment (the CLI, run
 * history, older clients), which show it as-is.
 */
const BUILD_FROM_PLAN_MESSAGE = "Build from plan";

/** The File preview's stand-in while closed: it renders nothing until a File is chosen. */
const EMPTY_FILE = create(FileSchema, {});

/**
 * Width and anchoring of the conversation reading column, shared by the
 * thread and the composer/banners block so they can never drift apart.
 *
 * Centered (the classic chat reading view, matching Cursor's agent panel):
 * with the session panel collapsed the column sits in the middle of the
 * row; opening the panel narrows the chat pane below the column max, so
 * the column simply fills it. The thread applies the same geometry via
 * `contentColumn="center"`, which adds the one gutter (`THREAD_GUTTER_CLASS`);
 * the header and the composer/banner block take the same gutter, so every
 * edge in the session lines up and only width and anchoring live here.
 */
const CONVERSATION_COLUMN_CLASS = "stg:mx-auto stg:w-full stg:max-w-3xl";

/** The narrowest the viewer may be and still keep its panel beside the conversation, in pixels (40rem). */
const PANEL_MIN_VIEWER_PX = 640;

/** What {@link SessionViewerProps.nextStep} is called with. */
export interface SessionNextStepContext {
  /** The agent the session runs, by organization and slug; undefined for the built-in assistant. */
  readonly agentRef: ResourceRef | undefined;
}

/** Props for {@link SessionViewer}. */
export interface SessionViewerProps {
  /** Session ID to load and display. */
  readonly sessionId: string;
  /**
   * Organization id to act in until the session has loaded (a slug is also accepted). After that
   * the viewer acts in the session's own organization (`session.metadata.org`),
   * whatever this prop says: a turn in a session belongs to that session's
   * organization.
   */
  readonly org: string;
  /**
   * GitHub connection state. Platform-specific — web passes
   * `useGitHubConnection(org)`, desktop passes
   * `useDesktopGitHubConnection(org)`.
   */
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  /**
   * Whether to enable GitHub workspace features in the composer.
   * @default true
   */
  readonly enableGitHub?: boolean;
  /**
   * Whether to enable local workspace features in the composer.
   * Web passes `deploymentMode === "local"`, desktop passes `true`.
   * @default false
   */
  readonly enableLocal?: boolean;
  /**
   * Native folder picker callback for desktop environments.
   *
   * When provided alongside `enableLocal`, the composer renders a
   * "Browse Folder" button that opens the system folder dialog.
   * Without this callback `enableLocal` alone is not sufficient
   * for the UI to render the local option.
   *
   * Desktop apps supply this via Tauri's dialog plugin. Web apps
   * omit it (no native picker available).
   */
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
  /**
   * Presentation audience for the viewer. `"endUser"` locks the
   * session's agent and hides the plugin, skill and vault
   * configuration in both the composer and the
   * inspector's Setup tab — for product-embedded chat where the agent
   * is configured upstream by the platform. The model selector,
   * interaction mode, file uploads, and workspace picker remain.
   *
   * `"guest"` (anonymous visitor with a guest token) is pure chat: it
   * additionally hides the model/mode pickers, file uploads, the
   * workspace picker, and the session panel, and skips the org-level
   * reads a guest principal cannot make — follow-ups simply continue
   * on the agent and version the session pinned.
   *
   * `"observer"` is a read-only transcript: no composer, no
   * approval/edit/retry/build affordances, no access management. The
   * viewer also self-selects observer for Slack and WhatsApp sessions
   * (the `stigmer.ai/channel-conversation-key` label) regardless of this
   * prop, since channel viewers hold `can_view` only.
   *
   * See {@link SessionAudience}.
   *
   * @default "integrator"
   */
  readonly audience?: SessionAudience;
  /**
   * Owner-pinned model/tier for every run sent from this viewer
   * (stigmer/stigmer#664) — for product-embedded conversations where
   * the platform, not the end user, decides what serves the session
   * (pair with `audience="endUser"`). A pinned model wins over the
   * composer, the persisted Console preference, and the last
   * execution's model — follow-ups and retries included — and hides
   * the model picker (a control that has no effect must not render).
   * Ignored for the `"guest"` audience, whose run config the
   * server-side share policy owns. See {@link SessionRunConfig}.
   */
  readonly runConfig?: SessionRunConfig;
  /**
   * The user's account-level execution defaults, typically from
   * `useAccountExecutionDefaults()` — same seam as
   * `NewSessionViewer.accountDefaults`. On the session page only
   * the `autoApprove` default applies: it seeds the session-scoped
   * auto-approve state so a declared `default_auto_approve` preference
   * covers follow-ups on existing sessions too. An explicit flip of the
   * run settings' switch wins for this session. Ignored for the
   * `"guest"` audience.
   */
  readonly accountDefaults?: AccountExecutionDefaults;
  /**
   * Whether the follow-up composer offers the model picker. `false`
   * hides the picker while keeping the SDK's model sourcing (persisted
   * preference, then the last execution's model) — for hosts whose
   * surrounding surface owns model choice without pinning it. Forced
   * off by a {@link SessionViewerProps.runConfig} model pin and for the
   * `"guest"` audience.
   *
   * @default true
   */
  readonly showModelSelector?: boolean;
  /**
   * The builder mode: the explorer, editor tabs, search, Changes and Files
   * beside the conversation, with the chip that opens them. The console
   * and the desktop app pass `<SessionInspector />`; an embed passes
   * nothing and ships none of its code. Without it every File and change
   * a turn produced still opens in place, from the turn. Never shown to a
   * guest.
   */
  readonly inspector?: ReactElement<SessionInspectorProps>;
  /**
   * Where Models & providers is, in the host's routing: a follow-up refused
   * for a missing provider key links there (the desktop app's hash router
   * passes `#/models`). Defaults to {@link DEFAULT_MODELS_HUB_HREF}.
   */
  readonly modelsHubHref?: string;
  /**
   * A routine's page, in the host's routing: the summary of a conversation a
   * routine started links its name there (the console's
   * `/library/routines/<org>/<slug>`). No link when omitted, or when the
   * reader may not see the routine.
   */
  readonly routineHref?: (routine: Routine) => string;
  /**
   * The agent's page, in the host's routing: a turn that ended on the
   * agent's setup, a connected app or a budget links there ("Open the
   * agent"), for a reader who may open it. No link when omitted.
   */
  readonly agentHref?: (agent: SessionAgentRef) => string;
  /**
   * Slot for host-injected header actions. Rendered in the top-right corner
   * of the viewer, beside the panel chip. Keeps the SDK organism
   * unopinionated about Console auth.
   */
  readonly headerActions?: ReactNode;
  /**
   * Whether the viewer offers its built-in whole-conversation export
   * (stigmer/stigmer#814), as the header's {@link TranscriptExportMenu}
   * for every audience, so wherever a conversation can be viewed its
   * transcript stays reachable. The export carries only
   * what the current caller can already read (`can_view`-scoped). Hosts
   * that own their export surface (or inert demo scenes) opt out.
   *
   * @default true
   */
  readonly transcriptExport?: boolean;
  /**
   * Host-injected access management control (e.g. the Console's
   * `ManageAccessButton` with its own permission gating), rendered in the
   * header beside the host's actions. Withheld from observers.
   */
  readonly accessSlot?: ReactNode;
  /**
   * What comes next, drawn at the foot of the conversation, under the
   * newest turn and above the composer, only once that turn has settled
   * (no run active, nothing waiting to send), and never for a guest, an
   * observer or a participant. Called with the agent the session runs, as
   * the view already holds it, so the host reads nothing twice. The console
   * passes the journey's next line (`JourneyNextLine`); without it nothing
   * is drawn.
   */
  readonly nextStep?: (session: SessionNextStepContext) => ReactNode;
  /** Called after a resource is applied, or a skill added, from the Files tab. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Component overrides for the conversation thread's chrome (message
   * bubbles, approval card, to-dos card, plan cards, thinking indicator) —
   * forwarded to the inner {@link MessageThread}. See
   * {@link MessageThreadSlots}. Define the object and its components at
   * module level (or memoize) so thread rows keep their streaming
   * re-render guarantees.
   */
  readonly threadSlots?: MessageThreadSlots;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Full-featured agent session viewer.
 *
 * Owns `useSessionPageFlow` internally and composes the conversation: its
 * summary with the status pill on the title's line, the thread (each step
 * one plain line, a finished turn leading with its answer and what it
 * produced), and the `SessionComposer` (Stop while a turn works) with the
 * run settings in its configure menu. A host that passes `inspector`
 * (`<SessionInspector />`) adds the builder mode beside it: the explorer,
 * search, read-only editor and the Changes, Files and Usage facets,
 * collapsed to a top-right chip until opened.
 *
 * Both regions render inside {@link SessionViewerLayout}, the frame shared
 * with {@link NewSessionViewer}, with the chat width persisted per viewer.
 *
 * Framework-agnostic — no Next.js, no Tauri, no routing deps. Host
 * apps inject platform-specific values via props.
 *
 * @example
 * ```tsx
 * // An embedding product's end user: the conversation alone.
 * <SessionViewer sessionId="ses_01jabc" org="acme" audience="endUser" />;
 * ```
 *
 * @example
 * ```tsx
 * // The console, with the builder mode.
 * function BuilderConversation({ sessionId, org }: { sessionId: string; org: string }) {
 *   const gitHub = useGitHubConnection(org);
 *   return <SessionViewer sessionId={sessionId} org={org} gitHubConnection={gitHub} enableGitHub inspector={<SessionInspector />} />;
 * }
 * ```
 */
export function SessionViewer({
  sessionId,
  org: orgProp,
  gitHubConnection,
  enableGitHub = true,
  enableLocal = false,
  onBrowseLocalFolder,
  audience = "integrator",
  runConfig,
  accountDefaults,
  showModelSelector = true,
  inspector,
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
  routineHref,
  agentHref,
  headerActions,
  transcriptExport = true,
  accessSlot,
  nextStep,
  onApplied,
  threadSlots,
  className,
}: SessionViewerProps) {
  // What this reader may do in a shared conversation, asked of the server
  // for a console's own conversations (guests and observers already have
  // their presentation and ask nothing). Asked before the flow, which sends
  // a participant's follow-up as the message alone.
  const access = useSessionAccess(
    audience !== "guest" && audience !== "observer" && sessionId ? sessionId : null,
  );
  const flow = useSessionPageFlow({
    sessionId,
    org: orgProp,
    audience,
    runConfig,
    accountDefaults,
    canDecide: access.canDecide,
  });
  const { conv } = flow;
  // Everything org-scoped below acts in the session's own organization once
  // it has loaded (the pickers, Files, plan actions and the reply), so a
  // session opened while another organization is active never files its
  // turns there (stigmer/stigmer#1580).
  const org = conv.org;
  const isGuest = audience === "guest";
  // A pinned model makes the picker a dead control (the pin wins over any
  // choice it could offer), so the pin forces it hidden; the guest strip
  // and the host's explicit opt-out compose with it.
  const modelSelectorVisible =
    showModelSelector && !isGuest && runConfig?.modelName === undefined;
  // Channel-originated sessions (Slack/WhatsApp conversations owned by the
  // channel runtime) are read-only for every console caller — the server
  // grants channel viewers can_view without can_create_run_in — so the
  // viewer self-selects the observer presentation regardless of the host's
  // audience. Every entry point (a conversations list, a pasted URL) renders
  // read-only without host wiring.
  const isObserver =
    audience === "observer" || isChannelOriginSession(conv.session);
  // What this reader may do in a shared conversation, asked of the server
  // for a console's own conversations (guests and observers already have
  // their presentation and ask nothing). A viewer reads it: the observer
  // presentation, with a line saying so. A participant sends messages and
  // implements plans, and leaves stopping, approvals and file decisions to
  // the conversation's owners (run#can_edit is the session owner's). Both
  // checks fail open, so a transient error never hides a control; the
  // server refuses whatever the answer misses.
  const { canSend, canDecide } = isObserver
    ? { canSend: true, canDecide: true }
    : access;
  const readsOnly = !isObserver && !canSend;
  const isReader = isObserver || readsOnly;
  const isParticipant = !isReader && !canDecide;
  const creatorName = creatorDisplayName(conv.session);
  // Curated audiences (endUser, guest, observer) lock the agent and hide the
  // integrator configuration; guest and observer add their own restrictions.
  const isCurated = audience !== "integrator" || isObserver;
  // Thumbs and run-health flags are the audience's call: the Console's
  // people and a conversation's reviewers grade runs, an embedded end user
  // and a chat-link visitor see neither.
  const runScores = showsRunScores(isObserver ? "observer" : audience);
  // The one flag every panel affordance keys on: the host passed no
  // inspector, or the audience forbids it (guests have no business with the
  // workspace). Everything the panel touches — the chip,
  // the region, plan auto-open, transcript path clicks — gates on this, so
  // the four affordances can never drift apart.
  // Under 640px of the viewer's own width there is no room for a panel
  // beside the conversation: the viewer then works as it does without an
  // inspector, every file opening in the preview window.
  const viewerRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrowerThan(viewerRef, PANEL_MIN_VIEWER_PX);
  const panelEnabled = inspector !== undefined && !isGuest && !narrow;
  const inspectorProps = inspector?.props;

  const [modelId, setModelId] = flow.model;
  const [interactionMode, setInteractionMode] = flow.interactionMode;
  const composerRef = useRef<SessionComposerHandle>(null);

  const phase =
    flow.displayRun?.status?.phase ??
    RunPhase.RUN_PHASE_UNSPECIFIED;
  const hasPhase = phase !== RunPhase.RUN_PHASE_UNSPECIFIED;

  // The conversation's Files, read once per conversation and again whenever
  // a turn starts or ends (the runs refetch shows both): a turn starts when
  // the Files sent with its message become the conversation's, and its
  // outputs register when it ends. They feed the Files facet, the plan card
  // and the plan tab.
  const refreshKey = useMemo(
    () =>
      flow.allRuns
        .map((run) => {
          const ended = isTerminalPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
          return `${run.metadata?.id ?? ""}:${ended ? "ended" : "started"}`;
        })
        .join(","),
    [flow.allRuns],
  );
  const sessionFiles = useSessionFiles(org || null, sessionId || null, refreshKey);
  const files = sessionFiles.files;

  // Facet arrival counts: rail badges inside the panel, the chip's dot-count
  // while collapsed. Arrivals never auto-open the panel (badge-only signal).
  const { hasWriteBacks, writeBackCount } = useSessionWriteBacks(flow.allRuns);
  const { outputs: sessionOutputs, outputCount } = useSessionOutputs(files, flow.allRuns);
  const { given: sessionGiven, givenCount } = useSessionGivenFiles(files, conv.resources);

  // The session's current plan (the latest Plan-mode turn's plan File) and
  // its viewer-owned draft. Ownership at this level is deliberate: the
  // panel unmounts facet content on every view switch, so a facet-local
  // draft would silently lose the user's edits (see usePlanDraft).
  const stigmer = useStigmer();
  const sessionPlan = useMemo(
    () => findLatestSessionPlan(files, flow.allRuns),
    [files, flow.allRuns],
  );
  const planFiles = useMemo(() => planFilesByRun(files, flow.allRuns), [files, flow.allRuns]);
  const planDraft = usePlanDraft(sessionPlan);

  // The plan the LIVE turn is writing right now (the H1 convention — see
  // findStreamingPlan), resolved at this level for the same reason
  // sessionPlan is: the panel's plan tab renders it. Recomputed per fold
  // commit by design — this component already re-renders on every commit
  // (it reads `flow`), and the scan touches only the last agent message.
  const streamingPlan = useMemo<SessionStreamingPlan | undefined>(() => {
    const live = findStreamingPlan(conv.activeTurn, conv.activeRun);
    return live && conv.activeTurn
      ? { executionId: conv.activeTurn.runId, displayText: live.displayText }
      : undefined;
  }, [conv.activeTurn, conv.activeRun]);
  const [isBuildingFromPlan, setIsBuildingFromPlan] = useState(false);
  const [planAttachFailed, setPlanAttachFailed] = useState(false);

  // WHICH plan the panel's plan document tab shows. `null` means the session's
  // current (latest) plan — the editable, buildable one; a run id
  // selects that turn's historical plan, rendered read-only. One tab, host-
  // controlled content.
  const [openPlanExecutionId, setOpenPlanExecutionId] = useState<string | null>(null);

  // The plan tab's identity across both plan lifecycles: while a plan
  // streams, the in-flight turn owns the tab (`<executionId>:streaming`);
  // once the turn returns its plan File, that File's identity (planDraftKey)
  // takes over. Each
  // transition is a NEW identity, so useSessionPanel's planKey trigger
  // auto-opens the tab the moment a plan starts streaming AND (idempotently)
  // when it settles into the published plan.
  const currentPlanKey = sessionPlan ? planDraftKey(sessionPlan) : null;
  const panelPlanKey = streamingPlan
    ? `${streamingPlan.executionId}:streaming`
    : currentPlanKey;

  // A new plan identity (a plan starting to stream, the first published
  // plan, or a refinement) supersedes any historical plan the user had
  // opened: the tab snaps back to "latest" so the auto-open always surfaces
  // the incoming plan. Adjust-state-during-render — own state only, the
  // established idiom.
  const [prevPlanKey, setPrevPlanKey] = useState(panelPlanKey);
  if (panelPlanKey !== prevPlanKey) {
    setPrevPlanKey(panelPlanKey);
    setOpenPlanExecutionId(null);
  }

  // The unified-panel controller: owns the open-editor group store, the
  // open/collapsed state, and the rail-view FSM. Shared with the launcher.
  // The editor store is owned here (never subscribed at this level)
  // so opening/switching files re-renders only the panel subtree — the
  // SessionPanelRegion subscribes, not the conversation column — preserving
  // streaming render isolation.
  const panel = useSessionPanel({
    phase: hasPhase ? phase : null,
    hasChanges: hasWriteBacks,
    // A streaming plan auto-opens the panel via its key, but a viewer
    // without one (no inspector, or a guest) suppresses the trigger along
    // with the chip.
    planKey: panelEnabled ? panelPlanKey : null,
    // Plans are found among the conversation's Files, read after mount: the
    // plan present when that first read lands is an old one, never a reason
    // to open the panel.
    planKeyReady: !sessionFiles.isLoading,
    // With the panel disabled the controller is pinned controlled-closed
    // and unobserved — airtight inertness, not just hidden UI: no intent
    // can flip state or reach the host's callback.
    open: panelEnabled ? inspectorProps?.open : false,
    defaultOpen: inspectorProps?.defaultOpen,
    // The panel opens on what the conversation made once it has Files, and
    // on the Explorer before: an empty listing is known only after it
    // loads, so the Explorer column itself always stays offered.
    defaultView: files.length > 0 ? CONVERSATION_FILES_VIEW_ID : "files",
    onOpenChange: panelEnabled ? inspectorProps?.onOpenChange : undefined,
  });

  const handleBuildFromPlan = useCallback(() => {
    // Switch the picker to Agent (so subsequent turns stay in Agent) and submit
    // the implement message through the composer's full pipeline.
    // `interactionMode: "agent"` is passed explicitly to win the same-tick race
    // where the composer prop has not yet re-rendered from "plan".
    setInteractionMode("agent");
    setPlanAttachFailed(false);

    // `buildFromPlan` (not message text) is what tells the runner to inject
    // the implement directive and the thread to hide the turn's message —
    // with or without the plan File (the runner picks the directive variant).
    const submitImplementTurn = (fileIds?: string[]) => {
      composerRef.current?.submit(BUILD_FROM_PLAN_MESSAGE, {
        interactionMode: "agent",
        buildFromPlan: true,
        fileIds,
      });
    };

    // No plan File (the bare-CTA fallback card) — nothing to hand over.
    if (!sessionPlan) {
      submitImplementTurn();
      return;
    }

    // Deterministic handoff. An unedited plan is the plan File itself: the
    // build turn names it, and the server makes it a resource of the
    // conversation with no second upload. An edited plan is uploaded as a
    // new File of the conversation (edit-as-input); the plan File stays
    // immutable.
    const draftText = planDraft.readDraft();
    if (draftText === null) {
      const planFileId = sessionPlan.file.metadata?.id;
      submitImplementTurn(planFileId ? [planFileId] : undefined);
      return;
    }
    setIsBuildingFromPlan(true);
    // The edited copy keeps the plan's filename: the runner finds it among
    // the conversation's Files by the plan filename convention
    // (`isPlanFileName`), and the download and the plan card agree on
    // one name.
    const planFileName = sessionPlan.file.spec?.filename ?? "plan.md";
    void (async () => {
      try {
        const planFile = await stigmer.file.uploadFile({
          org,
          sessionId,
          filename: planFileName,
          mimeType: "text/markdown",
          content: new TextEncoder().encode(draftText),
        });
        const editedFileId = planFile.metadata?.id;
        if (!editedFileId) throw new Error("the uploaded plan came back without an id");
        submitImplementTurn([editedFileId]);
      } catch {
        // Plan File plumbing must never block the build: implement from
        // conversation history alone, and say so (non-blocking notice).
        setPlanAttachFailed(true);
        submitImplementTurn();
      } finally {
        setIsBuildingFromPlan(false);
      }
    })();
  }, [setInteractionMode, sessionPlan, planDraft.readDraft, stigmer, org, sessionId]);

  const [openChange, setOpenChange] = useState<DisplayFileChange | null>(null);

  // "Open plan" (a thread plan card, or the Files facet's plan.md) → the
  // panel's plan document tab. Opening the LATEST plan clears the historical
  // selection (the tab shows the editable current plan); any other run
  // id opens that turn's plan read-only in the same tab.
  // Without an inspector the plan opens read-only in the File preview.
  const [previewFile, setPreviewFile] = useState<StigmerFile | null>(null);
  const handleOpenPlan = useCallback(
    (executionId: string) => {
      if (!panelEnabled) {
        const planFile = planFiles.get(executionId) ?? sessionPlan?.file;
        if (planFile) setPreviewFile(planFile);
        return;
      }
      setOpenPlanExecutionId(
        sessionPlan && executionId === sessionPlan.runId
          ? null
          : executionId,
      );
      panel.openPlanDocument();
    },
    [panelEnabled, planFiles, sessionPlan, panel.openPlanDocument],
  );

  // A Files-facet row → an editor-pane document tab, by its document key.
  // Writing the editors store re-renders only the panel subtree (which
  // subscribes), never this streaming column. Plan Files are routed to the
  // plan tab upstream (in FilesTab), so they never reach here; a double
  // click pins the tab the leading single click opened, as the file tree
  // does.
  const handleOpenFileDocument = panel.openFileDocument;
  const handleActivateFileDocument = panel.pinFileDocument;

  // Open a transcript tool-call file path in the panel's read-only editor.
  // Resolves the (possibly absolute / subdir-prefixed) path to a
  // repo/root-relative selection the editor can fetch; on a definite hit it
  // opens the file (expanding the panel) and returns `true` (handled),
  // otherwise returns `false` so the path keeps its default copy / GitHub-link
  // behavior. Writing the editor store re-renders only the panel subtree
  // (which subscribes), never this streaming column.
  const handleTranscriptFilePathClick = useCallback(
    (path: string): boolean => {
      // With no inspector there is no file viewer: a path a turn changed
      // opens that change's diff; any other keeps its default copy behavior.
      // The path is matched by its place in the workspace, never by its
      // tail, so docs/README.md never opens a root README.md's change.
      if (!panelEnabled) {
        const place = workspacePlace(path, flow.sandboxWorkspaceRoot);
        const change = deriveRunFileChanges(flow.allRuns).find((candidate) => candidate.path === place);
        if (change === undefined) return false;
        setOpenChange(change);
        return true;
      }
      const selection = resolveWorkspaceFileSelection(
        path,
        flow.workspace.entries,
        flow.sandboxWorkspaceRoot,
      );
      if (!selection) return false;
      panel.openFile(selection.entryId, selection.path);
      return true;
    },
    [panelEnabled, flow.allRuns, flow.workspace.entries, flow.sandboxWorkspaceRoot, panel.openFile],
  );

  // What a turn's outcome opens: a File the turn returned as the inspector's
  // document tab when this is its newest version there, else in the File
  // preview; a change in the inspector, else as its diff when the run
  // captured it.
  const handleOpenOutputFile = useCallback(
    (file: StigmerFile) => {
      const id = file.metadata?.id;
      const newest = sessionOutputs.some((entry) => entry.file.metadata?.id === id);
      if (panelEnabled && newest) {
        handleOpenFileDocument(outputKey(file));
        return;
      }
      setPreviewFile(file);
    },
    [panelEnabled, sessionOutputs, handleOpenFileDocument],
  );
  const canOpenTurnChange = useCallback(
    (change: TurnChange) => panelEnabled || change.captured !== undefined,
    [panelEnabled],
  );
  const handleOpenTurnChange = useCallback(
    (change: TurnChange) => {
      if (panelEnabled && handleTranscriptFilePathClick(change.path)) return;
      if (change.captured !== undefined) setOpenChange(change.captured);
    },
    [panelEnabled, handleTranscriptFilePathClick],
  );

  if (conv.isLoading) {
    return (
      <div className={cn("stg:flex stg:h-full stg:w-full stg:flex-col", className)}>
        <ThreadSkeleton className="stg:flex-1 stg:px-0" />
      </div>
    );
  }

  if (conv.loadError) {
    return <SessionLoadError error={conv.loadError} />;
  }

  if (!conv.session && !conv.isLoading) {
    // Where the conversation will be, its composer in place and closed: it
    // can't send before the session exists.
    return (
      <SessionStarting className={className}>
        {!isObserver && (
          <SessionComposer
            onSubmit={() => {}}
            disabled
            org={org}
            harness={flow.harness}
            defaultModelId={modelId}
            agentRunDefaults={flow.agentRunDefaults}
            interactionMode={interactionMode}
            showInteractionModePicker={!isGuest}
            showModelSelector={modelSelectorVisible}
            enableFiles={!isGuest}
            workspace={isGuest ? undefined : flow.workspace}
            agentRef={flow.agentRef}
            lockAgent={isCurated}
            className={cn("stg:py-3", THREAD_GUTTER_CLASS)}
          />
        )}
      </SessionStarting>
    );
  }

  // The header's controls: host actions + the panel chip. The chip is the
  // panel's always-mounted toggle; while collapsed it carries only the
  // pending-item count. How the session stands is the summary's status pill
  // on the title's line (SessionSummary). A viewer without an inspector (an
  // embed, or a guest) has no toggle: it is simply absent. Access and the
  // transcript export are header actions for every viewer, inspector or
  // not.
  const headerCorner = (
    <>
      {headerActions}
      {/* Observers cannot manage access (no can_grant_access /
          can_view_access on a channel session): withheld rather than
          left to fail server-side. */}
      {!isObserver && accessSlot}
      {transcriptExport && <TranscriptExportMenu sessionId={sessionId} />}
      {panelEnabled && (
        <SessionPanelChip
          isOpen={panel.isOpen}
          onToggle={panel.isOpen ? panel.closePanel : panel.openPanel}
          badgeCount={writeBackCount + outputCount + givenCount}
        />
      )}
    </>
  );
  // They ride the conversation's title row once it has one, so they stay
  // with the conversation column and never cover the thread or the
  // inspector (stigmer#2709, #2726); before that, the layout gives them a
  // row of their own.
  const summaryShows = conv.session !== null && conv.turns.length > 0;

  return (
    <>
    <div ref={viewerRef} className="stg:flex stg:h-full stg:w-full stg:flex-col">
    <SessionViewerLayout
      className={className}
      headerActions={summaryShows ? undefined : headerCorner}
      splitStorageKey="stgm-session-chat-width"
      conversation={
        <ConversationColumn
          sessionId={sessionId}
          flow={flow}
          modelId={modelId}
          setModelId={setModelId}
          interactionMode={interactionMode}
          setInteractionMode={setInteractionMode}
          composerRef={composerRef}
          org={org}
          gitHubConnection={gitHubConnection}
          enableGitHub={enableGitHub}
          enableLocal={enableLocal}
          onBrowseLocalFolder={onBrowseLocalFolder}
          onBuildFromPlan={handleBuildFromPlan}
          onOpenPlan={handleOpenPlan}
          planFiles={planFiles}
          isBuildingFromPlan={isBuildingFromPlan}
          planAttachFailed={planAttachFailed}
          onDismissPlanAttachFailed={() => setPlanAttachFailed(false)}
          onFilePathClick={handleTranscriptFilePathClick}
          isCurated={isCurated}
          isGuest={isGuest}
          isObserver={isReader}
          isParticipant={isParticipant}
          creatorName={creatorName}
          runScores={runScores}
          modelSelectorVisible={modelSelectorVisible}
          threadSlots={threadSlots}
          files={files}
          onOpenOutputFile={handleOpenOutputFile}
          canOpenTurnChange={canOpenTurnChange}
          onOpenTurnChange={handleOpenTurnChange}
          modelsHubHref={modelsHubHref}
          routineHref={routineHref}
          agentHref={agentHref}
          summaryActions={summaryShows ? headerCorner : undefined}
          nextStep={nextStep}
        />
      }
      panel={
        panel.isOpen && panelEnabled ? (
          <SessionInspectorContext.Provider
            value={{
              kind: "session",
              scope: {
                flow,
                org,
                panel,
                onApplied,
                // Implementing a plan submits a run, a write an observer or a
                // viewer cannot make (can_create_run_in is the owners' and
                // participants').
                onImplementPlan: isReader ? undefined : handleBuildFromPlan,
                // A plan is implemented by a turn of its own, never queued
                // behind a working one.
                implementPlanDisabled:
                  isReader || conv.activePhase !== null || !conv.canSendFollowUp || isBuildingFromPlan,
                sessionPlan,
                sessionFiles: files,
                sessionOutputs,
                sessionGiven,
                onFilesShown: sessionFiles.refetch,
                streamingPlan,
                planDraft,
                openPlanExecutionId,
                onOpenPlan: handleOpenPlan,
                onOpenFileDocument: handleOpenFileDocument,
                onActivateFileDocument: handleActivateFileDocument,
                enableLocal,
                onBrowseLocalFolder,
              },
            }}
          >
            {inspector}
          </SessionInspectorContext.Provider>
        ) : null
      }
    />
    </div>
    <FilePreviewModal
      file={previewFile ?? EMPTY_FILE}
      org={org}
      isTerminal
      open={previewFile !== null}
      onClose={() => setPreviewFile(null)}
      // A guest's credential may read a File and nothing more (stigmer#1481).
      readOnly={isGuest}
      onApplied={isGuest ? undefined : onApplied}
    />
    <TurnChangeDialog change={openChange} onClose={() => setOpenChange(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Conversation column (left/primary)
// ---------------------------------------------------------------------------

interface ConversationColumnProps {
  readonly sessionId: string;
  readonly flow: ReturnType<typeof useSessionPageFlow>;
  readonly modelId: string | undefined;
  readonly setModelId: (id: string) => void;
  readonly interactionMode: InteractionModeOption;
  readonly setInteractionMode: (mode: InteractionModeOption) => void;
  readonly composerRef: React.RefObject<SessionComposerHandle | null>;
  readonly org: string;
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  readonly enableGitHub: boolean;
  readonly enableLocal: boolean;
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
  readonly onBuildFromPlan: () => void;
  /** Opens a plan in the panel's plan document tab (thread card "Open plan"). */
  readonly onOpenPlan: (executionId: string) => void;
  /** Each Plan-mode turn's plan File, by run id, for the thread's plan cards. */
  readonly planFiles: ReadonlyMap<string, StigmerFile>;
  /** True while the edited plan is being uploaded ahead of the build turn. */
  readonly isBuildingFromPlan: boolean;
  /** True when the last build fell back to a message-only implement. */
  readonly planAttachFailed: boolean;
  readonly onDismissPlanAttachFailed: () => void;
  /**
   * Opens a transcript tool-call file path in the Viewer. Returns `true` when it
   * resolved and opened the file (suppressing the link's default), `false` to
   * let the path keep its copy / GitHub-link behavior.
   */
  readonly onFilePathClick: (path: string) => boolean;
  /** Curated audience (endUser, guest, or observer): locked agent, no integrator pickers. */
  readonly isCurated: boolean;
  /** Guest audience: pure chat — additionally no model picker, mode picker, file uploads, or workspace. */
  readonly isGuest: boolean;
  /**
   * A reader (an observer, a viewer of a shared conversation, a channel
   * conversation): a read-only transcript. No composer, no
   * approval/edit/retry/build affordances, no decision surfaces, and a
   * one-line footer saying so; live stream indicators stay (watching an
   * in-flight turn is the point).
   */
  readonly isObserver: boolean;
  /**
   * A participant in a shared conversation: sends messages, but stopping,
   * approvals and file decisions stay with its owners, so those controls
   * are withheld and a pending decision names who it waits on.
   */
  readonly isParticipant: boolean;
  /** The conversation's creator, as a participant reads it ("Waiting for …"). */
  readonly creatorName: string;
  /** Whether the thread shows run scores (thumbs and run-health flags). */
  readonly runScores: boolean;
  /**
   * Whether the composer offers the model picker — the composed result
   * of the host's `showModelSelector`, the guest strip, and a
   * `runConfig` model pin (a pinned model makes the picker a dead
   * control, so the pin forces it hidden).
   */
  readonly modelSelectorVisible: boolean;
  readonly threadSlots?: MessageThreadSlots;
  readonly files: readonly StigmerFile[];
  /** Opens a File a turn returned, in place. */
  readonly onOpenOutputFile: (file: StigmerFile) => void;
  /** Whether a turn's change can be shown here. */
  readonly canOpenTurnChange: (change: TurnChange) => boolean;
  /** Opens a turn's change, in place. */
  readonly onOpenTurnChange: (change: TurnChange) => void;
  readonly modelsHubHref: string;
  readonly routineHref?: (routine: Routine) => string;
  readonly agentHref?: (agent: SessionAgentRef) => string;
  /** The header's controls, drawn on the summary's title row. */
  readonly summaryActions?: ReactNode;
  /** The host's next step, drawn under a settled turn (see {@link SessionViewerProps.nextStep}). */
  readonly nextStep?: (session: SessionNextStepContext) => ReactNode;
}

/**
 * Tells an <AgentChat> frame around the view what the conversation is
 * doing, so its closed popup button can say it. A no-op elsewhere.
 */
function useReportChatActivity(activeTurn: Turn | null, lastTurn: Turn | undefined, files: readonly StigmerFile[]) {
  const report = useContext(ChatActivityReporterContext);
  const activity = useMemo(() => chatActivityOf(activeTurn, lastTurn, files, Date.now()), [activeTurn, lastTurn, files]);
  useEffect(() => {
    report?.(activity);
  }, [report, activity]);
}

const ConversationColumn = memo(function ConversationColumn({
  sessionId,
  flow,
  modelId,
  setModelId,
  interactionMode,
  setInteractionMode,
  composerRef,
  org,
  gitHubConnection,
  enableGitHub,
  enableLocal,
  onBrowseLocalFolder,
  onBuildFromPlan,
  onOpenPlan,
  planFiles,
  isBuildingFromPlan,
  planAttachFailed,
  onDismissPlanAttachFailed,
  onFilePathClick,
  isCurated,
  isGuest,
  isObserver,
  isParticipant,
  creatorName,
  runScores,
  modelSelectorVisible,
  threadSlots,
  files,
  onOpenOutputFile,
  canOpenTurnChange,
  onOpenTurnChange,
  modelsHubHref,
  routineHref,
  agentHref,
  summaryActions,
  nextStep,
}: ConversationColumnProps) {
  const { conv } = flow;
  useReportChatActivity(conv.activeTurn, conv.turns.at(-1), files);
  // How the next turn runs, in the composer's configure menu: never a
  // guest's (the share policy owns its run), and the auto-approve switch
  // only for the conversation's owners.
  const runSettingsRow = useRunSettings(flow, !isParticipant, isCurated);
  // The owner by name for a waiting step; unnamed, the step says "the owner".
  const creator = conv.session?.status?.audit?.specAudit?.createdBy;
  const approverName = creator?.displayName || creator?.email || undefined;
  const extraSettings = useMemo(() => (isGuest ? undefined : [runSettingsRow]), [isGuest, runSettingsRow]);

  // Each ended turn closes with what it produced, from the conversation's
  // Files and the turn's own run. Its changed files are the one place a
  // turn's edits are seen and undone: Undo for whoever decides (never a
  // reader, a teammate or a guest, whose credential is refused file
  // decisions, stigmer#1481), and only on the newest turn, whose undecided
  // edits the next message keeps.
  const reviewFileChanges = conv.reviewFileChanges;
  const decidesFiles = !isObserver && !isParticipant && !isGuest;
  const newestRunId = conv.turns.at(-1)?.runId;
  const turnUndo = useMemo<TurnOutcomeUndo>(
    () => ({
      onUndo: (changeSetId, options) => void reviewFileChanges(changeSetId, "undo", options).catch(() => undefined),
      busyKeys: conv.submittingFileDecisionKeys,
      errors: conv.fileDecisionErrors,
    }),
    [reviewFileChanges, conv.submittingFileDecisionKeys, conv.fileDecisionErrors],
  );
  const renderTurnOutcome = useCallback(
    (turn: Turn) => (
      <TurnOutcome
        outcome={turnOutcome(turn, files, conv.runs.find((run) => run.metadata?.id === turn.runId))}
        onOpenFile={onOpenOutputFile}
        canOpenChange={canOpenTurnChange}
        onOpenChange={onOpenTurnChange}
        undo={decidesFiles && turn.runId === newestRunId ? turnUndo : undefined}
      />
    ),
    [files, conv.runs, onOpenOutputFile, canOpenTurnChange, onOpenTurnChange, decidesFiles, newestRunId, turnUndo],
  );
  // Answer failures are NOT folded into this banner: they surface in-card,
  // beside the exact gate that failed (see MessageThread's answerErrors →
  // ApprovalCard), matching the file-review card. A single banner cannot name
  // which of several concurrent gates failed. The scalar conv.answerError
  // stays available for headless/`ink` consumers.
  // The last turn's ending notice: its act (recover, Continue, the model
  // picker) and its link, for this reader (`useTurnEndingWiring`).
  const columnRef = useRef<HTMLDivElement>(null);
  const lastTurn = conv.turns.at(-1);
  const lastRun = lastTurn === undefined ? undefined : conv.runs.find((run) => run.metadata?.id === lastTurn.runId);
  const lastMessage = lastRun?.spec?.message ?? "";
  const sessionAgent = agentRefOfSession(conv.session);
  const ending = useTurnEndingWiring({
    lastTurn,
    orgId: conv.session?.metadata?.org ?? "",
    canSend: !isObserver,
    decides: !isObserver && !isParticipant,
    send: flow.handleSubmit,
    // A build turn's label is no message to send again: it would drop the build's flag.
    retryMessage: lastMessage !== "" && lastMessage !== "execute" && lastRun?.spec?.buildFromPlan !== true ? lastMessage : undefined,
    modelsHubHref,
    ...(agentHref !== undefined && sessionAgent !== null ? { agentHref: agentHref({ org: sessionAgent.org, slug: sessionAgent.slug }) } : {}),
    columnRef,
  });
  // A refused recover reads as a refused send does (its typed reason: the
  // plan's hours, another turn unfinished), never as raw text.
  const sendError = conv.sendError ?? conv.stopError ?? ending.error;
  // A message that didn't send says why on its own bubble; a plain send
  // failure is not said a second time above the composer.
  const unsentInThread = !!conv.sendError && !!conv.pendingUserMessage;

  // The next message starts a conversation on the selected agent when the
  // session has no turn yet, or when the person picked a different agent
  // than the session runs: that is when the keys the agent will read from
  // the person's My vault are named. Guests and observers
  // never send on their own agent choice.
  const hasTurns = conv.turns.length > 0;
  const sessionAgentRef = agentRefOfSession(conv.session);
  const runsSessionAgent = isSameAgent(flow.agentRef, sessionAgentRef);
  // The newest turn has settled: something ran, nothing runs now and
  // nothing waits to be sent. The host's next step is drawn only then.
  const settled = hasTurns && conv.activePhase === null && !conv.pendingUserMessage && !conv.isSending;
  // The vaults the conversation uses, as the composer's vault picker
  // starts from them, and who may change them: only its creator.
  const sessionVaultRefs = useMemo<ResourceRef[]>(
    () =>
      (conv.session?.spec?.vaults ?? []).map((ref) => ({ org: ref.org, slug: ref.slug })),
    [conv.session],
  );
  const sessionIncludesMyVault = conv.session?.spec?.includeMyVault ?? false;
  const sessionCreatorId = conv.session?.status?.audit?.specAudit?.createdBy?.id ?? "";
  const disclosePersonalKeys = !isGuest && !isObserver && (!hasTurns || !runsSessionAgent);
  // On the session's own agent the next message runs the session's pin,
  // so the line names what that version declares.
  const personalKeysVersionHash = runsSessionAgent
    ? conv.session?.status?.agentVersionHash || undefined
    : undefined;

  // Retry a terminal-failed run by resending its originating message
  // through the full submit pipeline (agent override, runtime-env, workspace).
  const onRetryRun = useCallback(
    (message: string) => {
      void flow.handleSubmit(message);
    },
    [flow.handleSubmit],
  );

  const currentAgentVersion = flow.agentVersion.currentHash;
  const ranOtherAgentVersion =
    currentAgentVersion !== "" &&
    flow.allRuns.some((run) => {
      const hash = run.status?.agentVersionHash ?? "";
      return hash !== "" && hash !== currentAgentVersion;
    });

  // Stop the live turn (the session's interrupt, escalating to terminate on
  // a repeat press). Only wired while the live turn is stoppable.
  const handleStop = useCallback(() => {
    void conv.stop();
  }, [conv.stop]);

  // Edit-and-resubmit: stop the in-flight turn, pre-fill the composer with
  // the original text, and remember which run is being edited. The
  // append-only run log is never rewritten — submitting while editing
  // creates a NEW run that carries `supersedesRunId`, and the
  // conversation read model hides the superseded turn so the edited message
  // replaces the original in place (Cursor-style, stigmer/stigmer#181).
  //
  // The editing state is explicit (banner + cancel in the composer) so the
  // supersede link only attaches when the user actually resubmits the edit.
  // Cancelling drops the link — a subsequent unrelated message appends
  // normally without hiding any history.
  const [editingExecutionId, setEditingExecutionId] = useState<string | null>(
    null,
  );
  const activeRunId = conv.activeTurn?.runId ?? null;

  const handleEditMessage = useCallback(
    (text: string) => {
      void conv.stop();
      setEditingExecutionId(activeRunId);
      composerRef.current?.setMessage(text);
      composerRef.current?.focus();
    },
    [conv.stop, activeRunId, composerRef],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingExecutionId(null);
    composerRef.current?.setMessage("");
  }, [composerRef]);

  // Submit wrapper that attaches the supersede link while editing, then
  // exits editing mode. Ordinary (non-editing) submits pass through as-is.
  const handleComposerSubmit = useCallback(
    (
      message: string,
      modelName?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      void flow.handleSubmit(
        message,
        modelName,
        editingExecutionId
          ? { ...context, supersedesRunId: editingExecutionId }
          : context,
      );
      setEditingExecutionId(null);
    },
    [flow.handleSubmit, editingExecutionId],
  );

  return (
    <div ref={columnRef} className="stg:@container/session stg:flex stg:h-full stg:min-w-0 stg:flex-col">
      {conv.session !== null && hasTurns && (
        <div className={cn(CONVERSATION_COLUMN_CLASS, THREAD_GUTTER_CLASS)}>
          <SessionSummary
            session={conv.session}
            turns={conv.turns}
            runs={conv.runs}
            files={files}
            showCost={runScores}
            routineHref={routineHref}
            readsRoutine={!isGuest}
            actions={summaryActions}
            decides={!isObserver && !isParticipant}
          />
        </div>
      )}
      <MessageThread
        turns={conv.turns}
        runs={conv.runs}
        planFiles={planFiles}
        pendingUserMessage={conv.pendingUserMessage}
        pendingFiles={conv.pendingFiles}
        queued={conv.queued}
        pendingMessageFailed={unsentInThread}
        pendingMessageError={conv.sendError ?? null}
        // Observers get a pure transcript: every interaction affordance
        // (retry, approvals, edit, build-from-plan) is opt-in via its
        // callback, so passing none removes the controls entirely. Opening
        // a plan read-only in the panel remains — reading is the point.
        onRetrySend={isObserver ? undefined : conv.retryLastSend}
        onRetryRun={isObserver ? undefined : onRetryRun}
        turnEnding={ending.wiring}
        // Approval mechanics are an OPERATOR surface, never a guest's:
        // the HITL gate protects the org's tools, and an anonymous
        // visitor is not its trustee. Guest runs run unattended
        // (gated tools auto-skip server-side), so nothing is ever pending on
        // a new run — withholding the callback is the belt-and-braces
        // for pre-existing sessions and embedders composing the SDK directly.
        // A participant's decisions are the owners' too (run#can_edit):
        // the pending line above the composer names who it waits on.
        onAnswerToolUse={isObserver || isGuest || isParticipant ? undefined : flow.answerToolUse}
        // Whoever cannot answer reads who does on the waiting step itself.
        approverName={approverName}
        answeringToolUseIds={conv.answeringToolUseIds}
        answerErrors={conv.answerErrors}
        // Stopping one background command follows the session Stop's rule:
        // the owners' act, never an observer's or a participant's.
        onStopBackgroundCommand={isObserver || isParticipant ? undefined : conv.stopBackgroundCommand}
        stoppingBackgroundToolUseIds={conv.stoppingBackgroundToolUseIds}
        stopBackgroundErrors={conv.stopBackgroundErrors}
        // Editing a message stops the run it started: an owner's act.
        onEditMessage={
          isObserver || isParticipant || !conv.isStoppable ? undefined : handleEditMessage
        }
        resources={conv.resources}
        onFilePathClick={onFilePathClick}
        sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
        // The agent version each turn ran, marked where it starts and
        // wherever it changes, only when a turn ran another version than
        // the agent's current one: a conversation on the current version
        // throughout reads no hash. A guest's pure chat shows none.
        agentVersionLabel={isGuest || !ranOtherAgentVersion ? undefined : flow.agentVersion.labelOf}
        // Building from a plan uploads it, a call a guest credential is
        // refused (stigmer#1481).
        onBuildFromPlan={isObserver || isGuest ? undefined : onBuildFromPlan}
        onOpenPlan={onOpenPlan}
        org={org}
        planActionsDisabled={
          isObserver || conv.activePhase !== null || !conv.canSendFollowUp || isBuildingFromPlan
        }
        planBuildPending={isBuildingFromPlan}
        contentColumn="center"
        slots={threadSlots}
        runScores={runScores}
        turnOutcome={renderTurnOutcome}
        // The header's pill and the plan say what the turn does; the
        // thread's tail speaks only for the background commands a turn
        // waits on.
        ambientLiveness={false}
        className="stg:flex-1"
      />
      <div className={CONVERSATION_COLUMN_CLASS}>
        {nextStep !== undefined && !isObserver && !isGuest && !isParticipant && settled && nextStep({ agentRef: sessionAgentRef ?? undefined })}
        {planAttachFailed && (
          <PlanAttachFailedNotice onDismiss={onDismissPlanAttachFailed} />
        )}
        {/* Live stream indicators stay for observers — watching an
            in-flight conversation is the point of observability. */}
        {conv.isReconnecting && <ReconnectingIndicator />}
        {conv.connectTimedOut && (
          <ConnectTimedOutBanner onRetry={conv.reconnectStream} />
        )}
        {/* The slow hint once nothing has arrived for a while; what the turn
            does and for how long is the header's pill and the plan. */}
        {conv.isSlow && !conv.connectTimedOut && <SlowIndicator />}
        {conv.streamError && (
          <StreamErrorBanner
            error={conv.streamError}
            onReconnect={conv.reconnectStream}
          />
        )}
        {!isObserver && sendError && !(unsentInThread && sendError === conv.sendError && isPlainSendError(sendError)) && (
          <SendErrorBanner error={sendError} modelsHubHref={modelsHubHref} />
        )}
        {/* Armed-only disclosure (#816 rework): auto-approve's way ON lives in
            the composer's run settings and the account preference; this strip is the
            always-visible proof it is on, plus the one-click way off. Never
            shown to observers (they cannot arm or disarm anything). */}
        {!isObserver && !isParticipant && flow.autoApproveAll && (
          <AutoApproveIndicator onTurnOff={() => flow.setAutoApproveAll(false)} />
        )}
        {/* The conversation keeps the agent version it started on; when the
            agent's author has saved since, this offers the one explicit
            move to the current version. Never for guests or observers. */}
        {!isObserver && !isGuest && !isParticipant && flow.agentVersion.isOutdated && (
          <AgentVersionNotice
            agentName={flow.agentVersion.agentName}
            personalKeys={flow.agentVersion.currentPersonalKeys}
            onUpdate={() => void flow.agentVersion.update()}
            isUpdating={flow.agentVersion.isUpdating}
            error={flow.agentVersion.updateError}
          />
        )}
        {/* While the turn works, the files it is changing so far; once it
            ends, the same files show under its Changed group. */}
        <FileChangeProgressBar progress={conv.fileChangeProgress} />
        {/* Observers and viewers never get a composer: the server denies
            them can_create_run_in, so the send surface simply is not
            offered — read-only by construction, not by a disabled state. */}
        {isObserver && <ReadOnlyNotice />}
        {!isObserver && (
          <SessionComposer
            ref={composerRef}
            onSubmit={handleComposerSubmit}
            isSubmitting={conv.isSending}
            disabled={!conv.canSendFollowUp}
            onStop={conv.isStoppable && !isParticipant ? handleStop : undefined}
            isStopping={conv.isStopping}
            isEditing={editingExecutionId != null}
            onCancelEdit={handleCancelEdit}
            org={org}
            harness={flow.harness}
            defaultModelId={modelId}
            agentRunDefaults={flow.agentRunDefaults}
            onModelChange={setModelId}
            onModelPickCleared={flow.clearModelPick}
            interactionMode={interactionMode}
            onInteractionModeChange={setInteractionMode}
            showInteractionModePicker={!isGuest}
            showModelSelector={modelSelectorVisible}
            enableFiles={!isGuest}
            workspace={isGuest ? undefined : flow.workspace}
            gitHubConnection={isGuest ? undefined : gitHubConnection}
            enableGitHub={enableGitHub && !isGuest}
            enableLocal={enableLocal && !isGuest}
            onBrowseLocalFolder={onBrowseLocalFolder}
            agentRef={flow.agentRef}
            // Guests get no agent machinery: the session's agent is already
            // bound server-side, and the picker's resolution path performs
            // org reads a guest token cannot make.
            onAgentRefChange={isGuest ? undefined : flow.setAgentRef}
            onAgentResolutionChange={isGuest ? undefined : flow.setResolution}
            // A participant sends on the conversation's own agent and vaults:
            // changing either is the owners' (session can_edit).
            lockAgent={isCurated || isParticipant}
            pluginRefs={isCurated ? undefined : flow.pluginRefs}
            onPluginRefsChange={isCurated ? undefined : flow.setPluginRefs}
            skillRefs={isCurated ? undefined : flow.skillRefs}
            onSkillRefsChange={isCurated ? undefined : flow.setSkillRefs}
            disclosePersonalKeys={disclosePersonalKeys}
            personalKeysVersionHash={personalKeysVersionHash}
            enableVaultPicker={!isGuest && !isCurated && !isObserver && !isParticipant}
            initialVaultRefs={sessionVaultRefs}
            initialIncludeMyVault={sessionIncludesMyVault}
            vaultPickCreatorId={sessionCreatorId}
            sessionId={sessionId}
            extraSettings={extraSettings}
            className={cn("stg:py-3", THREAD_GUTTER_CLASS)}
          />
        )}
      </div>
    </div>
  );
});

/** The conversation's creator by name, for "Waiting for …"; a fallback when the stamp carries none. */
/** A transcript path as its place in the workspace: below the sandbox's root when it is under it, without a leading "./". */
function workspacePlace(path: string, root: string | undefined): string {
  const base = root?.replace(/\/$/, "") ?? "";
  const inWorkspace = base !== "" && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
  return inWorkspace.startsWith("./") ? inWorkspace.slice(2) : inWorkspace;
}

function creatorDisplayName(session: Session | null): string {
  const creator = session?.status?.audit?.specAudit?.createdBy;
  return creator?.displayName || creator?.email || "the conversation's owner";
}

/** A reader's footer, where the composer would be: what its absence means. */
function ReadOnlyNotice() {
  return (
    <ComposerStrip role="status" icon={<StripGlyph kind="eye" />}>
      You&rsquo;re reading this conversation. Only its members can reply.
    </ComposerStrip>
  );
}

/** A strip's 16px glyph: an info mark, a clock, an eye. */
function StripGlyph({ kind }: { readonly kind: "info" | "clock" | "eye" }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="stg:text-muted-foreground">
      {kind === "info" && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </>
      )}
      {kind === "clock" && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </>
      )}
      {kind === "eye" && (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components (error states)
// ---------------------------------------------------------------------------

/** What the page says when the server never answered: the session is safe on it. */
const UNREACHABLE_WORDS = "Stigmer's server didn't answer. The session itself is safe; nothing in it was lost.";

/**
 * A session that didn't open: what happened, in the client's words for the
 * error's kind (the drawing's words when the server never answered), a
 * quiet mark, and one act.
 */
function SessionLoadError({ error }: { error: Error }) {
  const unreachable = isUnreachable(error);
  return (
    <div className="stg:flex stg:min-h-[60vh] stg:flex-col stg:items-center stg:justify-center stg:px-4">
      <div className="stg:flex stg:w-full stg:max-w-sm stg:flex-col stg:items-center stg:gap-4 stg:text-center">
        <span className="stg:text-muted-foreground" aria-hidden="true">
          {unreachable ? <NoConnectionIcon /> : <AlertCircleIcon />}
        </span>
        <div className="stg:flex stg:flex-col stg:gap-2">
          <h1 className="stg:m-0 stg:text-lg stg:font-semibold">This session didn&rsquo;t open</h1>
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{unreachable ? UNREACHABLE_WORDS : getUserMessage(error)}</p>
        </div>
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <FailureHelpLine />
      </div>
    </div>
  );
}

/**
 * A session being made: the header and the first message in outline, where
 * they will be, so the page does not jump when they arrive.
 */
function SessionStarting({ className, children }: { readonly className?: string; readonly children?: ReactNode }) {
  return (
    <div className={cn("stg:flex stg:h-full stg:w-full stg:flex-col", className)}>
      <div className={cn("stg:flex stg:min-h-0 stg:flex-1 stg:flex-col stg:gap-5 stg:pt-6", CONVERSATION_COLUMN_CLASS)} role="status" aria-label="Opening the session">
        <div className={cn("stg:flex stg:flex-col stg:gap-2 stg:border-b stg:border-border stg:pb-4", THREAD_GUTTER_CLASS)}>
          <div className="stg:h-5 stg:w-56 stg:animate-pulse stg:rounded-md stg:bg-muted" />
          <div className="stg:h-3 stg:w-36 stg:animate-pulse stg:rounded-md stg:bg-muted" />
        </div>
        <div className={cn("stg:flex stg:flex-col stg:gap-3", THREAD_GUTTER_CLASS)}>
          <div className="stg:h-16 stg:w-3/5 stg:self-end stg:animate-pulse stg:rounded-xl stg:bg-muted" />
          <p className="stg:m-0 stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-muted-foreground">
            <LoaderIcon />
            Opening the session…
          </p>
        </div>
      </div>
      <div className={CONVERSATION_COLUMN_CLASS}>{children}</div>
    </div>
  );
}

/**
 * Non-blocking notice for a build that fell back to message-only implement
 * (the approved plan.md could not be uploaded/attached). The build itself
 * proceeded — the agent follows the plan from conversation history — so this
 * is a status, not an alert, and it is dismissible.
 */
function PlanAttachFailedNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <ComposerStrip
      role="status"
      icon={<StripGlyph kind="info" />}
      act={
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      Couldn&rsquo;t attach plan.md. The agent follows the plan from the conversation instead.
    </ComposerStrip>
  );
}

/** A send failure with no notice of its own: the generic error, not a key, hours or secret to set up. */
function isPlainSendError(error: Error): boolean {
  return !isSecretFlowError(error) && providerKeyRequired(error) === null && agentHoursUsedUp(error) === null;
}

function SendErrorBanner({ error, modelsHubHref }: { readonly error: Error; readonly modelsHubHref: string }) {
  if (isSecretFlowError(error)) {
    return <SecretFlowErrorGuide error={error} className={cn("stg:my-2", THREAD_GUTTER_CLASS)} />;
  }
  if (providerKeyRequired(error) !== null) {
    return <ProviderKeyNotice error={error} modelsHubHref={modelsHubHref} className={cn("stg:my-2", THREAD_GUTTER_CLASS)} />;
  }
  if (agentHoursUsedUp(error) !== null) {
    return <AgentHoursNotice error={error} className={cn("stg:my-2", THREAD_GUTTER_CLASS)} />;
  }
  return <ErrorMessage error={error} className={cn("stg:my-2", THREAD_GUTTER_CLASS)} />;
}

function ReconnectingIndicator() {
  return (
    <ComposerStrip role="status" aria-live="polite" tone="working" icon={<SpinnerIcon size={12} className="stg:text-muted-foreground stg:motion-reduce:animate-none" />}>
      Reconnecting… The agent keeps working; what it did meanwhile appears when the connection is back.
    </ComposerStrip>
  );
}

/**
 * Actionable banner for the connect-timeout watchdog: the stream opened but
 * never delivered a first snapshot — the agent hasn't started. Mirrors
 * {@link StreamErrorBanner}'s shape (message + Retry) since both resolve via
 * the same `reconnect()` path, but its copy names the specific failure.
 */
function ConnectTimedOutBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <ComposerStrip
      role="alert"
      icon={<StripGlyph kind="info" />}
      act={
        <Button variant="ghost" size="xs" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      The agent hasn&rsquo;t started yet. Your message is kept; try again to look once more.
    </ComposerStrip>
  );
}

/**
 * Low-weight informational hint for the slow-stall watchdog: a live stream has
 * gone quiet longer than usual. A working turn sends its liveness at an
 * interval well inside the watchdog's window, so this means no word from the
 * turn at all, not a long silent tool. Never an error and offers no action —
 * the stream is still expected to resume on its own.
 */
function SlowIndicator() {
  return (
    <ComposerStrip role="status" aria-live="polite" icon={<StripGlyph kind="clock" />}>
      This is taking longer than usual. It keeps going if you leave; the session will be here when it&rsquo;s done.
    </ComposerStrip>
  );
}

function StreamErrorBanner({
  error,
  onReconnect,
}: {
  error: Error;
  onReconnect: () => void;
}) {
  return (
    <div role="alert" className="stg:flex stg:items-center stg:gap-3 stg:border-t stg:border-border stg:bg-muted stg:px-4 stg:py-2.5">
      <p className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-sm stg:text-muted-foreground">
        {getUserMessage(error)}
      </p>
      <Button variant="outline" size="xs" onClick={onReconnect}>
        Reconnect
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function NoConnectionIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
      <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
      <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
      <path d="M5 13a10 10 0 0 1 5.24-2.76" />
      <path d="M12 20h.01" />
    </svg>
  );
}

function AlertCircleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function LoaderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="stg:shrink-0 stg:animate-spin stg:text-muted-foreground stg:motion-reduce:animate-none" aria-hidden="true">
      <path d="M10 2a8 8 0 0 1 0 16" strokeLinecap="round" />
    </svg>
  );
}

