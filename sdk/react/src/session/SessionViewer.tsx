"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage, type AttachmentInput, type ResourceRef } from "@stigmer/sdk";
import {
  GetArtifactContentRequestSchema,
  UploadAttachmentRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection.js";
import type { WorkspaceFileLister } from "../workspace/WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "../workspace/WorkspaceFileReader.js";
import type { WorkspaceContentSearcher } from "../workspace/WorkspaceContentSearcher.js";
import { resolveWorkspaceFileSelection } from "../workspace/resolveWorkspaceFileSelection.js";
import {
  WorkspaceSurface,
  type SurfaceVirtualDocument,
} from "../workspace/WorkspaceSurface.js";
import type { InteractionModeOption, SessionComposerHandle, SessionComposerSubmitContext } from "../composer/index.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";
import { ResizableSplit } from "../internal/ResizableSplit.js";
import { SelectionStore } from "../internal/store/selection-store.js";
import { useWorkspaceEditors, isVirtualEntryId } from "../internal/store/index.js";
import { ThreadSelectionContext } from "../execution/ThreadSelectionContext.js";
import { useSelectedThreadItem } from "../execution/useThreadSelection.js";
import { MessageThread } from "../execution/MessageThread.js";
import { FileChangeProgressBar } from "../execution/FileChangeProgressBar.js";
import { FileReviewDock } from "../execution/FileReviewDock.js";
import {
  FilePathContext,
  type FilePathContextValue,
} from "../execution/FilePathContext.js";
import { ThreadSkeleton } from "../execution/ThreadSkeleton.js";
import { SessionComposer } from "../composer/index.js";
import { SecretFlowErrorGuide, isSecretFlowError } from "../error/index.js";
import { useStigmer } from "../hooks.js";
import {
  findLatestSessionPlan,
  findPlanArtifact,
  type SessionPlan,
} from "../library/detect-plan-artifact.js";
import { findStreamingPlan } from "../library/detect-streaming-plan.js";
import { useSessionPageFlow } from "./useSessionPageFlow.js";
import { useOpenFileChange } from "./useOpenFileChange.js";
import { usePlanDraft, planDraftKey, type PlanDraftController } from "./usePlanDraft.js";
import { PlanEditor } from "./PlanEditor.js";
import { PlanStreamingDocument } from "./PlanStreamingDocument.js";
import { PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH } from "./plan-document.js";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "./artifact-document.js";
import { ArtifactDocument } from "../execution/ArtifactDocument.js";
import { useSessionRailViews } from "./useSessionRailViews.js";
import { useSessionPanel, type SessionPanelController } from "./useSessionPanel.js";
import { SessionPanelChip } from "./SessionPanelChip.js";
import { useSessionWriteBacks } from "./useSessionWriteBacks.js";
import {
  useSessionArtifacts,
  artifactKey,
  type SessionArtifactEntry,
} from "./useSessionArtifacts.js";
import type { SetupTabProps } from "./facets/SetupTab.js";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { RuntimeEnvProvider } from "./runtime-env.js";
import type { SessionAudience } from "./audience.js";

/**
 * Where the approved plan mounts in the implement execution's workspace —
 * the harnesses' standard attachment inputs directory, where the runner's
 * implement-plan directive points the agent (shared/implement-plan-prompt.ts).
 * Attaching under the plan's own filename (e.g. `feature-x_a1b2c3d4.plan.md`) is what
 * makes the build implement the document the user approved (including in-place
 * edits), not a paraphrase from memory; the runner detects it by the plan
 * filename convention (`isPlanArtifactName`), so the exact name is free to vary.
 */
function approvedPlanMountPath(planFileName: string): string {
  return `.stigmer/inputs/${planFileName}`;
}

/**
 * The build turn's user message — a short human-readable label, NOT the
 * implement instruction. The agent-facing instruction is runner-injected
 * (keyed off `executionConfig.buildFromPlan`). The thread hides the turn
 * entirely from the same flag (the plan card above it is the visible cause);
 * this label exists for surfaces without that treatment (the CLI, execution
 * history, older clients), which show it as-is.
 */
const BUILD_FROM_PLAN_MESSAGE = "Build from plan";

/**
 * A plan the active execution is writing right now, resolved at the viewer
 * level (from `findStreamingPlan`) so the panel's plan tab can render it
 * live. The streaming sibling of {@link SessionPlan}: `executionId` keys the
 * document (a new turn's stream resets the tab's view state) and forms the
 * `<executionId>:streaming` identity for the plan-tab auto-open trigger.
 */
interface SessionStreamingPlan {
  /** ID of the execution writing the plan. */
  readonly executionId: string;
  /** The live plan text (fence-stripped display projection). */
  readonly displayText: string;
}

/**
 * Reads the published plan's full text for the build handoff. Refuses a
 * truncated read (content RPC caps at 512 KB): attaching a partial plan would
 * silently implement half a document — the caller falls back to
 * conversation-history implement instead.
 */
async function fetchPlanText(
  stigmer: ReturnType<typeof useStigmer>,
  plan: SessionPlan,
): Promise<string> {
  const result = await stigmer.agentExecution.getArtifactContent(
    create(GetArtifactContentRequestSchema, {
      executionId: plan.executionId,
      storageKey: plan.artifact.storageKey,
    }),
  );
  if (result.truncated) {
    throw new Error("plan content truncated — not attaching a partial plan");
  }
  return new TextDecoder().decode(result.content);
}

/**
 * Width and anchoring of the conversation reading column, shared by the
 * thread and the composer/banners block so they can never drift apart.
 *
 * Centered (the classic chat reading view, matching Cursor's agent panel):
 * with the session panel collapsed the column sits in the middle of the
 * row; opening the panel narrows the chat pane below the column max, so
 * the column simply fills it. The thread applies the same geometry via
 * `contentColumn="center"`, which adds the item gutter; the composer/banner
 * block's children carry their own edge padding, so only width and
 * anchoring live here.
 */
const CONVERSATION_COLUMN_CLASS = "mx-auto w-full max-w-3xl";

/** Props for {@link SessionViewer}. */
export interface SessionViewerProps {
  /** Session ID to load and display. */
  readonly sessionId: string;
  /** Organization slug. */
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
   * Platform-injected file lister for workspace entries. When provided,
   * each entry in the Setup tab's workspace section renders an
   * expandable file tree. (DD-004 capability injection, DD-011 opt-in.)
   */
  readonly workspaceFileLister?: WorkspaceFileLister;
  /**
   * Platform-injected content reader for the read-only file viewer. When
   * provided, clicking a file in the Workspace tree opens it in a contextual
   * "Viewer" tab. GitHub Contents/blob on web, Tauri fs on desktop; `undefined`
   * degrades the viewer to an "unavailable here" state (DD-004, DD-011 opt-in).
   */
  readonly workspaceFileReader?: WorkspaceFileReader;
  /**
   * Platform-injected content (text) searcher. When provided, the session
   * panel's Search pane gains a `Name | Text` toggle for full-text search
   * across the workspace. Desktop injects a native ripgrep-backed searcher;
   * web leaves it undefined (git content search needs a branch-accurate
   * backend — DD-09), keeping Search filename-only there (DD-004, DD-011 opt-in).
   */
  readonly workspaceContentSearcher?: WorkspaceContentSearcher;
  /**
   * Supplies host-app environment variables for every follow-up
   * execution (e.g. short-lived credentials for MCP tools, minted as
   * the signed-in user). Evaluated fresh at each send; host values win
   * over composer-collected env on key collisions. If the provider
   * throws, the send is blocked and an error banner is shown — see
   * {@link RuntimeEnvProvider}.
   */
  readonly getRuntimeEnv?: RuntimeEnvProvider;
  /**
   * Presentation audience for the viewer. `"endUser"` locks the
   * session's agent and hides the MCP server, skill, and
   * session-variable configuration in both the composer and the
   * inspector's Setup tab — for product-embedded chat where the agent
   * is configured upstream by the platform. The model selector,
   * interaction mode, attachments, and workspace picker remain. See
   * {@link SessionAudience}.
   *
   * @default "integrator"
   */
  readonly audience?: SessionAudience;
  /**
   * Slot for host-injected header actions. Rendered in the top-right corner
   * of the viewer, beside the panel chip. Keeps the SDK organism
   * unopinionated about Console auth (DD-004).
   */
  readonly headerActions?: ReactNode;
  /**
   * Host-injected access management control (e.g. the Console's
   * `ManageAccessButton` with its own permission gating). Rendered inside
   * the panel's Config facet rather than the header — access is session
   * configuration, not a moment-to-moment action (DD-004 slot injection).
   */
  readonly accessSlot?: ReactNode;
  /** Called after a resource is applied from the Artifacts tab. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Full-featured agent session viewer — the graph-less analog of
 * `WorkflowExecutionViewer`.
 *
 * Owns `useSessionPageFlow` internally and composes:
 * - **Conversation column** (primary): `MessageThread` + error
 *   banners + `SessionComposer`
 * - **Session panel** (secondary): the unified `WorkspaceSurface` — explorer,
 *   search, read-only editor, and the session facets (Config, Changes,
 *   Artifacts, Usage, Inspect) as injected rail views. Collapsed by default
 *   to a top-right chip; opening a file (tree, search, or a transcript path)
 *   expands it.
 *
 * Connected via `ResizableSplit` with persisted chat width.
 *
 * Thread selection is provided via `ThreadSelectionContext` (Phase 2
 * opt-in) for render-isolated per-item selection.
 *
 * Framework-agnostic — no Next.js, no Tauri, no routing deps. Host
 * apps inject platform-specific values via props (DD-004/DD-016).
 *
 * @example
 * ```tsx
 * // Web (cloud execution)
 * <SessionViewer
 *   sessionId={id}
 *   org={org}
 *   gitHubConnection={gitHubConnection}
 *   enableGitHub
 *   headerActions={<ShareButton sessionId={id} />}
 * />
 *
 * // Desktop (local execution with native picker)
 * <SessionViewer
 *   sessionId={id}
 *   org={org}
 *   enableLocal
 *   onBrowseLocalFolder={browseLocalFolder}
 *   headerActions={<ShareButton sessionId={id} />}
 * />
 * ```
 */
export function SessionViewer({
  sessionId,
  org,
  gitHubConnection,
  enableGitHub = true,
  enableLocal = false,
  onBrowseLocalFolder,
  workspaceFileLister,
  workspaceFileReader,
  workspaceContentSearcher,
  getRuntimeEnv,
  audience = "integrator",
  headerActions,
  accessSlot,
  onApplied,
  className,
}: SessionViewerProps) {
  const flow = useSessionPageFlow({ sessionId, org, getRuntimeEnv });
  const { conv } = flow;
  const isEndUser = audience === "endUser";

  const [modelId, setModelId] = flow.model;
  const [interactionMode, setInteractionMode] = flow.interactionMode;
  const composerRef = useRef<SessionComposerHandle>(null);

  const selectionStoreRef = useRef<SelectionStore | null>(null);
  if (!selectionStoreRef.current) {
    selectionStoreRef.current = new SelectionStore();
  }
  const selectionStore = selectionStoreRef.current;

  const phase =
    flow.displayExecution?.status?.phase ??
    ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const hasPhase = phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  // Facet arrival counts: rail badges inside the panel, the chip's dot-count
  // while collapsed. Arrivals never auto-open the panel (badge-only signal).
  const { hasWriteBacks, writeBackCount } = useSessionWriteBacks(flow.allExecutions);
  const { artifactCount } = useSessionArtifacts(flow.allExecutions);

  // The session's current plan (latest published plan.md across executions)
  // and its viewer-owned draft. Ownership at this level is deliberate: the
  // panel unmounts facet content on every view switch, so a facet-local
  // draft would silently lose the user's edits (see usePlanDraft).
  const stigmer = useStigmer();
  const sessionPlan = useMemo(
    () => findLatestSessionPlan(flow.allExecutions),
    [flow.allExecutions],
  );
  const planDraft = usePlanDraft(sessionPlan);

  // The plan the ACTIVE turn is writing right now (the H1 convention — see
  // findStreamingPlan), resolved at this level for the same reason
  // sessionPlan is: the panel's plan tab renders it. Recomputed per stream
  // commit by design — this component already re-renders on every commit
  // (it reads `flow`), and the scan touches only the last AI message.
  const streamingPlan = useMemo<SessionStreamingPlan | undefined>(() => {
    const activeExec = conv.activeStreamExecution;
    const live = findStreamingPlan(activeExec);
    const executionId = activeExec?.metadata?.id;
    return live && executionId
      ? { executionId, displayText: live.displayText }
      : undefined;
  }, [conv.activeStreamExecution]);
  const [isBuildingFromPlan, setIsBuildingFromPlan] = useState(false);
  const [planAttachFailed, setPlanAttachFailed] = useState(false);

  // WHICH plan the panel's plan document tab shows. `null` means the session's
  // current (latest) plan — the editable, buildable one; an execution id
  // selects that turn's historical plan, rendered read-only. One tab, host-
  // controlled content (Decision 3 in DD-16).
  const [openPlanExecutionId, setOpenPlanExecutionId] = useState<string | null>(null);

  // The plan tab's identity across both plan lifecycles: while a plan
  // streams, the in-flight turn owns the tab (`<executionId>:streaming`);
  // once published, the artifact identity (planDraftKey) takes over. Each
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
  // open/collapsed state, and the rail-view FSM. Shared with the launcher
  // (DD-016). The editor store is owned here (never subscribed at this level)
  // so opening/switching files re-renders only the panel subtree — the
  // SessionPanelRegion subscribes, not the conversation column — preserving
  // streaming render isolation (DD-009/DD-010, invariant 2).
  const panel = useSessionPanel({
    phase: hasPhase ? phase : null,
    hasChanges: hasWriteBacks,
    planKey: panelPlanKey,
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
    // with or without the attachment (the runner picks the directive variant).
    const submitImplementTurn = (attachments?: AttachmentInput[]) => {
      composerRef.current?.submit(BUILD_FROM_PLAN_MESSAGE, {
        interactionMode: "agent",
        buildFromPlan: true,
        attachments,
      });
    };

    // No published artifact (the bare-CTA fallback card) — nothing to attach.
    if (!sessionPlan) {
      submitImplementTurn();
      return;
    }

    // Deterministic handoff: upload the APPROVED plan (draft if edited, else
    // the artifact text — one uniform path) and attach it to the implement
    // execution. The published artifact itself stays immutable; the approved
    // copy is a new input on the build turn (edit-as-input provenance).
    setIsBuildingFromPlan(true);
    // The approved copy keeps the published plan's filename, so the mounted
    // input, the download, and the plan card all agree on one name.
    const planFileName = sessionPlan.artifact.name;
    void (async () => {
      try {
        const approvedText =
          planDraft.readDraft() ?? (await fetchPlanText(stigmer, sessionPlan));
        const response = await stigmer.agentExecution.uploadAttachment(
          create(UploadAttachmentRequestSchema, {
            filename: planFileName,
            content: new TextEncoder().encode(approvedText),
            contentType: "text/markdown",
          }),
        );
        submitImplementTurn([
          {
            filename: planFileName,
            storageKey: response.storageKey,
            mountPath: approvedPlanMountPath(planFileName),
            contentType: "text/markdown",
          },
        ]);
      } catch {
        // Attachment plumbing must never block the build: implement from
        // conversation history alone, and say so (non-blocking notice).
        setPlanAttachFailed(true);
        submitImplementTurn();
      } finally {
        setIsBuildingFromPlan(false);
      }
    })();
  }, [setInteractionMode, sessionPlan, planDraft.readDraft, stigmer]);

  // "Open plan" (a thread plan card, or the Artifacts facet's plan.md) → the
  // panel's plan document tab. Opening the LATEST plan clears the historical
  // selection (the tab shows the editable current plan); any other execution
  // id opens that turn's plan read-only in the same tab.
  const handleOpenPlan = useCallback(
    (executionId: string) => {
      setOpenPlanExecutionId(
        sessionPlan && executionId === sessionPlan.executionId
          ? null
          : executionId,
      );
      panel.openPlanDocument();
    },
    [sessionPlan, panel.openPlanDocument],
  );

  // "Open artifact" (an Artifacts-facet row) → an editor-pane document tab.
  // Writing the editors store re-renders only the panel subtree (which
  // subscribes), never this streaming column. Plan artifacts are routed to the
  // plan tab upstream (in ArtifactsTab), so they never reach here.
  const handleOpenArtifact = useCallback(
    (entry: SessionArtifactEntry) => {
      panel.openArtifact(entry.artifact);
    },
    [panel.openArtifact],
  );

  // Double-click an artifact row → pin its tab (the leading single click already
  // opened the preview via `handleOpenArtifact`). Mirrors the file tree's
  // preview/pin split; plan artifacts are routed to the plan tab upstream (in
  // ArtifactsTab) and never reach here.
  const handleActivateArtifact = useCallback(
    (entry: SessionArtifactEntry) => {
      panel.pinArtifact(entry.artifact);
    },
    [panel.pinArtifact],
  );

  // Open a transcript tool-call file path in the panel's read-only editor.
  // Resolves the (possibly absolute / subdir-prefixed) path to a
  // repo/root-relative selection the editor can fetch; on a definite hit it
  // opens the file (expanding the panel) and returns `true` (handled),
  // otherwise returns `false` so the path keeps its default copy / GitHub-link
  // behavior. Writing the editor store re-renders only the panel subtree
  // (which subscribes), never this streaming column.
  const handleTranscriptFilePathClick = useCallback(
    (path: string): boolean => {
      const selection = resolveWorkspaceFileSelection(
        path,
        flow.workspace.entries,
        flow.sandboxWorkspaceRoot,
      );
      if (!selection) return false;
      panel.openFile(selection.entryId, selection.path);
      return true;
    },
    [flow.workspace.entries, flow.sandboxWorkspaceRoot, panel.openFile],
  );

  if (conv.isLoading) {
    return (
      <div className={cn("flex h-full w-full flex-col", className)}>
        <ThreadSkeleton className="flex-1 px-0" />
      </div>
    );
  }

  if (conv.loadError) {
    return <SessionLoadError error={conv.loadError} />;
  }

  if (!conv.session && !conv.isLoading) {
    return <SessionStarting />;
  }

  return (
    <div className={cn("relative flex h-full w-full flex-col", className)}>
      {/* Top-right controls: host actions + the panel chip. The chip is the
          panel's always-mounted toggle; while collapsed it carries only the
          pending-item count. Execution status is never surfaced as header
          chrome — the thread itself communicates run state. */}
      <div className="absolute top-2 right-6 z-10 flex items-center gap-2">
        {headerActions}
        <SessionPanelChip
          isOpen={panel.isOpen}
          onToggle={panel.isOpen ? panel.closePanel : panel.openPanel}
          badgeCount={writeBackCount + artifactCount}
        />
      </div>

      <ThreadSelectionContext.Provider value={selectionStore}>
        {/* One layout, collapsed by default: chat fills the row until the panel
            opens, then becomes the fixed narrow pane on the left while the
            panel takes the flexible region. Collapsing goes through the
            split's `collapsedPane` (CSS, not conditional structure), so the
            conversation is always the same first child and an open/close never
            remounts it (invariant 1). */}
        <ResizableSplit
          resizablePane="primary"
          collapsedPane={panel.isOpen ? "none" : "secondary"}
          defaultSize={420}
          minSize={320}
          maxSize={640}
          storageKey="stgm-session-chat-width"
          responsiveCollapse={panel.isOpen ? "primary" : "none"}
          ariaLabel="Resize chat panel"
          className="min-h-0 flex-1"
          primary={
            <ConversationColumn
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
              isBuildingFromPlan={isBuildingFromPlan}
              planAttachFailed={planAttachFailed}
              onDismissPlanAttachFailed={() => setPlanAttachFailed(false)}
              onFilePathClick={handleTranscriptFilePathClick}
              isEndUser={isEndUser}
            />
          }
          secondary={
            panel.isOpen ? (
              <SessionPanelRegion
                flow={flow}
                org={org}
                panel={panel}
                accessSlot={accessSlot}
                onApplied={onApplied}
                onImplementPlan={handleBuildFromPlan}
                implementPlanDisabled={!conv.canSendFollowUp || isBuildingFromPlan}
                sessionPlan={sessionPlan}
                streamingPlan={streamingPlan}
                planDraft={planDraft}
                openPlanExecutionId={openPlanExecutionId}
                onOpenPlan={handleOpenPlan}
                onOpenArtifact={handleOpenArtifact}
                onActivateArtifact={handleActivateArtifact}
                enableLocal={enableLocal}
                onBrowseLocalFolder={onBrowseLocalFolder}
                workspaceFileLister={workspaceFileLister}
                workspaceFileReader={workspaceFileReader}
                workspaceContentSearcher={workspaceContentSearcher}
                isEndUser={isEndUser}
              />
            ) : null
          }
        />
      </ThreadSelectionContext.Provider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation column (left/primary)
// ---------------------------------------------------------------------------

interface ConversationColumnProps {
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
  /** True while the approved plan is being uploaded ahead of the build turn. */
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
  readonly isEndUser: boolean;
}

const ConversationColumn = memo(function ConversationColumn({
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
  isBuildingFromPlan,
  planAttachFailed,
  onDismissPlanAttachFailed,
  onFilePathClick,
  isEndUser,
}: ConversationColumnProps) {
  const { conv } = flow;
  // Approval failures are NOT folded into this banner: they now surface in-card,
  // beside the exact gate that failed (see MessageThread's approvalErrors →
  // ApprovalCard), matching the file-review card. A single banner cannot name
  // which of several concurrent gates failed. The scalar conv.approvalError
  // stays available for headless/`ink` consumers.
  const sendError = flow.submitError ?? conv.sendError ?? conv.stopError;

  // Retry a terminal-failed execution by resending its originating message
  // through the full submit pipeline (agent override, runtime-env, workspace).
  const onRetryExecution = useCallback(
    (message: string) => {
      void flow.handleSubmit(message);
    },
    [flow.handleSubmit],
  );

  // Stop the in-flight turn (graceful cancel, escalating to terminate on a
  // repeat press). Only wired while the active execution is stoppable.
  const handleStop = useCallback(() => {
    void conv.stop();
  }, [conv.stop]);

  // Edit-and-resubmit: stop the in-flight turn, pre-fill the composer with
  // the original text, and remember which execution is being edited. The
  // append-only execution log is never rewritten — submitting while editing
  // creates a NEW execution that carries `supersedesExecutionId`, and the
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
  const activeExecutionId = conv.activeStreamExecution?.metadata?.id ?? null;

  const handleEditMessage = useCallback(
    (text: string) => {
      void conv.stop();
      setEditingExecutionId(activeExecutionId);
      composerRef.current?.setMessage(text);
      composerRef.current?.focus();
    },
    [conv.stop, activeExecutionId, composerRef],
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
          ? { ...context, supersedesExecutionId: editingExecutionId }
          : context,
      );
      setEditingExecutionId(null);
    },
    [flow.handleSubmit, editingExecutionId],
  );

  // The composer-docked FileReviewDock sits OUTSIDE MessageThread, so the
  // thread's own FilePathContext provider does not reach it. This provider
  // gives the dock's file list the same path resolution and click routing
  // (open in the panel's viewer; GitHub/copy fallback) as the transcript —
  // one click behavior for a path everywhere in the session. Memoized so the
  // dock's memoized cards are not invalidated by unrelated renders (DD-010).
  const dockFilePathCtx = useMemo<FilePathContextValue>(
    () => ({
      workspaceEntries: conv.workspaceEntries ?? [],
      onFilePathClick,
    }),
    [conv.workspaceEntries, onFilePathClick],
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <MessageThread
        executions={conv.completedExecutions}
        activeStreamExecution={conv.activeStreamExecution}
        pendingUserMessage={conv.pendingUserMessage}
        pendingMessageFailed={!!conv.sendError && !!conv.pendingUserMessage}
        onRetrySend={conv.retryLastSend}
        onRetryExecution={onRetryExecution}
        onApprovalSubmit={flow.submitApproval}
        submittingApprovalIds={conv.submittingApprovalIds}
        approvalErrors={conv.approvalErrors}
        showFileReviewRecords
        onEditMessage={conv.isStoppable ? handleEditMessage : undefined}
        workspaceEntries={conv.workspaceEntries}
        onFilePathClick={onFilePathClick}
        sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
        onBuildFromPlan={onBuildFromPlan}
        onOpenPlan={onOpenPlan}
        org={org}
        planActionsDisabled={!conv.canSendFollowUp || isBuildingFromPlan}
        planBuildPending={isBuildingFromPlan}
        contentColumn="center"
        className="flex-1"
      />
      <div className={CONVERSATION_COLUMN_CLASS}>
        {planAttachFailed && (
          <PlanAttachFailedNotice onDismiss={onDismissPlanAttachFailed} />
        )}
        {conv.isReconnecting && <ReconnectingIndicator />}
        {conv.connectTimedOut && (
          <ConnectTimedOutBanner onRetry={conv.reconnectStream} />
        )}
        {conv.isSlow && !conv.connectTimedOut && <SlowIndicator />}
        {conv.streamError && (
          <StreamErrorBanner
            error={conv.streamError}
            onReconnect={conv.reconnectStream}
          />
        )}
        {sendError && <SendErrorBanner error={sendError} />}
        {flow.autoApproveAll && (
          <AutoApproveIndicator onTurnOff={() => flow.setAutoApproveAll(false)} />
        )}
        {/* Pending file reviews dock here — pinned above the composer so the
            decision the agent is blocked on can never scroll out of view. The
            thread renders only observational rows (badges) and read-only
            settled records; this is the one decision surface. */}
        <FilePathContext.Provider value={dockFilePathCtx}>
          {/* Mid-run live capture (DD-32): the "N files changed so far" strip for
              a still-running turn. Mutually exclusive with the dock below —
              progress shows while CAPTURING, the dock once AWAITING_REVIEW — so it
              hands off cleanly when review opens. Non-interactive. */}
          <FileChangeProgressBar progress={conv.fileChangeProgress} />
          <FileReviewDock
            changeSets={conv.fileChangeSets}
            onSubmit={conv.submitFileDecision}
            submittingDecisionKeys={conv.submittingFileDecisionKeys}
            decisionErrors={conv.fileDecisionErrors}
          />
        </FilePathContext.Provider>
        <SessionComposer
          ref={composerRef}
          onSubmit={handleComposerSubmit}
          isSubmitting={conv.isSending}
          disabled={!conv.canSendFollowUp}
          onStop={conv.isStoppable ? handleStop : undefined}
          isStopping={conv.isStopping}
          isEditing={editingExecutionId != null}
          onCancelEdit={handleCancelEdit}
          org={org}
          harness={flow.harness}
          defaultModelId={modelId}
          onModelChange={setModelId}
          interactionMode={interactionMode}
          onInteractionModeChange={setInteractionMode}
          showInteractionModePicker
          workspace={flow.workspace}
          gitHubConnection={gitHubConnection}
          enableGitHub={enableGitHub}
          enableLocal={enableLocal}
          onBrowseLocalFolder={onBrowseLocalFolder}
          agentRef={flow.agentRef}
          onAgentRefChange={flow.setAgentRef}
          onAgentResolutionChange={flow.setResolution}
          isDefaultAgent={flow.isDefaultAgent}
          lockAgent={isEndUser}
          mcpServerUsages={isEndUser ? undefined : flow.mcpServerUsages}
          onMcpServerUsagesChange={isEndUser ? undefined : flow.setMcpServerUsages}
          skillRefs={isEndUser ? undefined : flow.skillRefs}
          onSkillRefsChange={isEndUser ? undefined : flow.setSkillRefs}
          sessionVariables={isEndUser ? undefined : flow.sessionVariables}
          className="px-4 py-3"
        />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Session panel region (right/secondary) — the unified panel's subtree
// ---------------------------------------------------------------------------

interface SessionPanelRegionProps {
  readonly flow: ReturnType<typeof useSessionPageFlow>;
  readonly org: string;
  /**
   * The panel controller owned by `SessionViewer`. Its editor store is
   * subscribed here (not at `SessionViewer`) so opening/switching files
   * re-renders only this region, never the conversation column.
   */
  readonly panel: SessionPanelController;
  /** Host access management control, surfaced in the Config facet. */
  readonly accessSlot?: ReactNode;
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Implement a plan (plan tab primary + Artifacts preview action). */
  readonly onImplementPlan?: () => void;
  readonly implementPlanDisabled?: boolean;
  /** The session's latest plan — the plan tab's editable content. */
  readonly sessionPlan?: SessionPlan;
  /**
   * The plan the active turn is writing right now. While present it OWNS the
   * plan tab: the tab renders the live document (`PlanStreamingDocument`)
   * instead of a published plan — the in-flight plan is the newest
   * deliverable, and the snap-back in `SessionViewer` has already cleared any
   * historical selection when this identity appeared.
   */
  readonly streamingPlan?: SessionStreamingPlan;
  /** Viewer-owned plan draft (survives panel collapse and view switches). */
  readonly planDraft: PlanDraftController;
  /**
   * Which plan the plan document tab shows: `null` for the latest (editable),
   * or an execution id whose historical plan renders read-only.
   */
  readonly openPlanExecutionId: string | null;
  /** Opens a plan in the plan tab (routed to the Artifacts facet's plan.md). */
  readonly onOpenPlan: (executionId: string) => void;
  /** Opens an artifact as an editor-pane document (routed to the Artifacts facet). */
  readonly onOpenArtifact: (entry: SessionArtifactEntry) => void;
  /** Pins an artifact's document tab — the double-click half of the open/pin split. */
  readonly onActivateArtifact: (entry: SessionArtifactEntry) => void;
  readonly enableLocal: boolean;
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
  readonly workspaceFileLister?: WorkspaceFileLister;
  readonly workspaceFileReader?: WorkspaceFileReader;
  readonly workspaceContentSearcher?: WorkspaceContentSearcher;
  readonly isEndUser: boolean;
}

function SessionPanelRegion({
  flow,
  org,
  panel,
  accessSlot,
  onApplied,
  onImplementPlan,
  implementPlanDisabled,
  sessionPlan,
  streamingPlan,
  planDraft,
  openPlanExecutionId,
  onOpenPlan,
  onOpenArtifact,
  onActivateArtifact,
  enableLocal,
  onBrowseLocalFolder,
  workspaceFileLister,
  workspaceFileReader,
  workspaceContentSearcher,
  isEndUser,
}: SessionPanelRegionProps) {
  const selectedItem = useSelectedThreadItem();
  const { editors, activeKey, activeFile, reveal } = useWorkspaceEditors(
    panel.editorsStore,
  );
  // Session artifacts, deduped by identity — the source both the Artifacts
  // rail-view badge and the open artifact document tabs resolve against.
  const { artifacts: sessionArtifacts } = useSessionArtifacts(flow.allExecutions);

  // Honor a pending jump-to-line reveal only while it targets the active editor
  // (an EditorReveal is structurally a RevealTarget). Switching tabs changes
  // activeKey, so a stale reveal for another tab is naturally ignored.
  const activeReveal =
    reveal && reveal.key === activeKey ? reveal : undefined;

  // This region is the level that subscribes to thread selection; report it to
  // the controller so an open panel can auto-surface the Inspect view. (A
  // collapsed panel never sees — and deliberately never reacts to — selection.)
  useEffect(() => {
    panel.notifySelection(selectedItem);
  }, [selectedItem, panel.notifySelection]);

  // Correlate the active file with its session change for diff-as-default
  // (DD-06 parity with the transcript's rendering of the same change). A
  // virtual document (the plan tab) is not a workspace file — pass `null` so
  // the hook's no-file guard skips the net-change fold entirely, rather than
  // relying on the correlation harmlessly missing the sentinel id.
  const openFileChange = useOpenFileChange(
    activeFile && !isVirtualEntryId(activeFile.entryId) ? activeFile : null,
    flow.allExecutions,
    flow.workspace.entries,
    flow.sandboxWorkspaceRoot,
  );

  // Resolve WHICH plan the plan document tab shows: the latest (editable,
  // buildable, draft-backed) unless a historical execution id was opened —
  // that plan renders read-only. A stale id (execution gone, or its plan
  // artifact missing) degrades to the latest rather than an empty tab.
  const openPlan = useMemo<SessionPlan | undefined>(() => {
    if (
      openPlanExecutionId === null ||
      openPlanExecutionId === sessionPlan?.executionId
    ) {
      return sessionPlan;
    }
    const execution = flow.allExecutions.find(
      (e) => e.metadata?.id === openPlanExecutionId,
    );
    const artifact = findPlanArtifact(execution);
    return artifact
      ? { executionId: openPlanExecutionId, artifact }
      : sessionPlan;
  }, [openPlanExecutionId, sessionPlan, flow.allExecutions]);

  // The plan document tab (SurfaceVirtualDocument): the panel's editor-area
  // rendering of the session's plan. Three states, in precedence order:
  // a STREAMING plan owns the tab (live document, no actions); otherwise the
  // resolved `openPlan` renders in the editor (keyed by plan identity so
  // switching plans resets view state cleanly); otherwise an honest empty
  // notice (DD-006) — reachable only when a streaming plan auto-opened the
  // tab and its turn then ended without publishing, with no earlier plan to
  // fall back to.
  const openPlanIsLatest = openPlan?.executionId === sessionPlan?.executionId;
  const planVirtualDocument = useMemo<SurfaceVirtualDocument>(() => {
    return {
      entryId: PLAN_DOCUMENT_ENTRY_ID,
      path: PLAN_DOCUMENT_PATH,
      content: streamingPlan ? (
        <PlanStreamingDocument
          key={`streaming-${streamingPlan.executionId}`}
          displayText={streamingPlan.displayText}
        />
      ) : openPlan ? (
        <PlanEditor
          key={planDraftKey(openPlan)}
          plan={openPlan}
          draft={openPlanIsLatest ? planDraft : undefined}
          onBuildFromPlan={openPlanIsLatest ? onImplementPlan : undefined}
          buildDisabled={implementPlanDisabled}
          readOnly={!openPlanIsLatest}
        />
      ) : (
        <PlanUnavailableNotice />
      ),
    };
  }, [
    streamingPlan,
    openPlan,
    openPlanIsLatest,
    planDraft,
    onImplementPlan,
    implementPlanDisabled,
  ]);

  // The open artifact document tabs (the artifact virtual-document FAMILY).
  // Built in a SEPARATE memo from the plan doc so artifact-tab churn never
  // recreates the plan doc (and vice versa). Bounded to what is actually open:
  // one document per editor whose entry id is the artifact family's, resolved
  // back to its `SessionArtifactEntry` by the same `artifactKey` used to open
  // it (single source of truth for artifact identity). Only the ACTIVE doc's
  // `content` is mounted by the surface, so building these elements is cheap;
  // keying on `contentHash` remounts a tab whose artifact was overwritten by a
  // later execution. A tab whose artifact no longer exists degrades to an
  // honest notice rather than vanishing.
  const artifactByKey = useMemo(
    () =>
      new Map(sessionArtifacts.map((entry) => [artifactKey(entry.artifact), entry])),
    [sessionArtifacts],
  );
  const artifactVirtualDocuments = useMemo<readonly SurfaceVirtualDocument[]>(() => {
    return editors
      .filter((editor) => editor.entryId === ARTIFACT_DOCUMENT_ENTRY_ID)
      .map((editor) => {
        const entry = artifactByKey.get(editor.path);
        return {
          entryId: ARTIFACT_DOCUMENT_ENTRY_ID,
          path: editor.path,
          content: entry ? (
            <ArtifactDocument
              key={entry.artifact.contentHash || editor.path}
              artifact={entry.artifact}
              executionId={entry.executionId}
              org={org}
              isTerminal={entry.isTerminal}
              onApplied={onApplied}
            />
          ) : (
            <ArtifactUnavailableNotice />
          ),
        };
      });
  }, [editors, artifactByKey, org, onApplied]);

  const virtualDocuments = useMemo<readonly SurfaceVirtualDocument[]>(
    () => [planVirtualDocument, ...artifactVirtualDocuments],
    [planVirtualDocument, artifactVirtualDocuments],
  );

  const handleRemoveAgent = useCallback(() => {
    flow.setAgentRef(null);
    flow.setResolution(null);
  }, [flow.setAgentRef, flow.setResolution]);

  const handleRemoveMcp = useCallback(
    (ref: ResourceRef) => {
      flow.setMcpServerUsages(
        flow.mcpServerUsages.filter(
          (u) => !(u.mcpServerRef.org === ref.org && u.mcpServerRef.slug === ref.slug),
        ),
      );
    },
    [flow.mcpServerUsages, flow.setMcpServerUsages],
  );

  const handleRemoveSkill = useCallback(
    (ref: ResourceRef) => {
      flow.setSkillRefs(
        flow.skillRefs.filter(
          (r) => !(r.org === ref.org && r.slug === ref.slug),
        ),
      );
    },
    [flow.skillRefs, flow.setSkillRefs],
  );

  const sessionConfig = useMemo<SetupTabProps>(
    () => ({
      agentRef: flow.agentRef,
      isDefaultAgent: flow.isDefaultAgent,
      mcpServerUsages: flow.mcpServerUsages,
      skillRefs: flow.skillRefs,
      sessionVariables: flow.sessionVariables,
      harness: flow.harness,
      executionTarget: flow.executionTarget,
      modelId: flow.model[0],
      // End users see the configuration but cannot strip it — the Config
      // facet renders read-only without mutation callbacks (DD-011).
      mutations: isEndUser
        ? undefined
        : {
            onRemoveAgent: flow.isDefaultAgent ? undefined : handleRemoveAgent,
            onRemoveMcp: handleRemoveMcp,
            onRemoveSkill: handleRemoveSkill,
          },
      accessSlot,
    }),
    [
      flow.agentRef, flow.isDefaultAgent, flow.mcpServerUsages, flow.skillRefs,
      flow.sessionVariables, flow.harness, flow.executionTarget, flow.model,
      isEndUser, handleRemoveAgent, handleRemoveMcp, handleRemoveSkill,
      accessSlot,
    ],
  );

  // The session facets (Config / Changes / Artifacts / Usage / Inspect) as
  // injected rail views — the full inspector feature set inside one panel.
  const railViews = useSessionRailViews({
    allExecutions: flow.allExecutions,
    org,
    sessionConfig,
    selectedItem,
    onApplied,
    onImplementPlan,
    onOpenPlan,
    onOpenArtifact,
    onActivateArtifact,
  });

  // Explorer-footer folder attach (desktop only — needs the native picker).
  // Same wiring the retired Workspace tab used.
  const canAddLocalFolder = enableLocal && !!onBrowseLocalFolder;
  const handleAddLocalFolder = useCallback(async () => {
    const path = await onBrowseLocalFolder?.();
    if (path) flow.workspace.addLocalPath(path);
  }, [onBrowseLocalFolder, flow.workspace.addLocalPath]);

  return (
    <WorkspaceSurface
      entries={flow.workspace.entries}
      lister={workspaceFileLister}
      reader={workspaceFileReader}
      searcher={workspaceContentSearcher}
      view={panel.view}
      onViewChange={panel.setView}
      extraViews={railViews}
      virtualDocuments={virtualDocuments}
      onRemoveEntry={flow.workspace.remove}
      onAddLocalFolder={canAddLocalFolder ? handleAddLocalFolder : undefined}
      editors={editors}
      selectedFile={activeFile}
      onOpenFile={panel.openFile}
      onActivateEditor={panel.activateEditor}
      onPinEditor={panel.pinEditor}
      onCloseEditor={panel.closeEditor}
      onCollapse={panel.closePanel}
      change={openFileChange ?? undefined}
      reveal={activeReveal}
      className="h-full"
    />
  );
}

// ---------------------------------------------------------------------------
// Local sub-components (error states)
// ---------------------------------------------------------------------------

function SessionLoadError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive-subtle">
          <ErrorTriangleIcon />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Failed to load session</h1>
          <p className="text-sm text-muted-foreground">{getUserMessage(error)}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function SessionStarting() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-2 text-center">
        <LoaderIcon />
        <p className="text-sm text-muted-foreground">Starting session…</p>
      </div>
    </div>
  );
}

/**
 * Low-weight, always-visible indicator shown while the session-scoped
 * auto-approve preference is active. The "Turn off" control reverts the
 * preference in one click — the safety affordance for "Approve & don't ask
 * again". Nothing about approvals appears until the user opts in at a gate.
 */
function AutoApproveIndicator({ onTurnOff }: { onTurnOff: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-t border-border-muted px-4 py-1.5 text-xs text-muted-foreground"
    >
      <ShieldCheckIcon />
      <span className="min-w-0 flex-1 truncate">
        Auto-approving tool calls for this session
      </span>
      <button
        type="button"
        onClick={onTurnOff}
        className="shrink-0 rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Turn off
      </button>
    </div>
  );
}

/**
 * The plan document tab's empty state — reachable only when a streaming plan
 * auto-opened the tab and its turn then ended without publishing (stopped or
 * failed) while the session has no earlier published plan to fall back to.
 * The partial plan reverts to the conversation (the thread un-collapses it),
 * so the notice points there. Never a blank pane (DD-006).
 */
function PlanUnavailableNotice() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-8 text-center"
    >
      <p className="text-xs font-medium text-foreground">
        This turn ended before a plan was completed.
      </p>
      <p className="text-xs text-muted-foreground">
        Any partial plan text remains in the conversation.
      </p>
    </div>
  );
}

/**
 * Shown in an artifact document tab whose artifact is no longer among the
 * session's outputs (an edge only reachable if the executions backing the tab
 * changed underneath it). The tab stays closable; the content is honest rather
 * than blank.
 */
function ArtifactUnavailableNotice() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-8 text-center"
    >
      <p className="text-xs font-medium text-foreground">
        This artifact is no longer available.
      </p>
      <p className="text-xs text-muted-foreground">
        It may have been replaced by a newer version of this session.
      </p>
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
    <div
      role="status"
      className="flex items-center gap-2 border-t border-border-muted px-4 py-1.5 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        Couldn&rsquo;t attach plan.md — the agent will follow the plan from the
        conversation instead.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Dismiss
      </button>
    </div>
  );
}

function SendErrorBanner({ error }: { error: Error }) {
  if (isSecretFlowError(error)) {
    return <SecretFlowErrorGuide error={error} className="mx-4 my-2" />;
  }
  return (
    <div role="alert" className="border-t border-border px-4 py-2 text-xs text-destructive">
      {getUserMessage(error)}
    </div>
  );
}

function ReconnectingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span className="truncate">Reconnecting…</span>
    </div>
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
    <div role="alert" className="flex items-center gap-3 border-t border-border bg-muted px-4 py-2.5">
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        The agent hasn&rsquo;t started yet.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-card"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Low-weight informational hint for the slow-stall watchdog: a live stream has
 * gone quiet longer than usual. Never an error and offers no action — the
 * stream is still expected to resume on its own.
 */
function SlowIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-border-muted px-4 py-1.5 text-xs text-muted-foreground"
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        Still working — this is taking longer than usual.
      </span>
    </div>
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
    <div role="alert" className="flex items-center gap-3 border-t border-border bg-muted px-4 py-2.5">
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {getUserMessage(error)}
      </p>
      <button
        type="button"
        onClick={onReconnect}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-card"
      >
        Reconnect
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function ErrorTriangleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function LoaderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto animate-spin text-muted-foreground">
      <path d="M10 2a8 8 0 0 1 0 16" strokeLinecap="round" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-success" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
