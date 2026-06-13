"use client";

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type ResourceRef } from "@stigmer/sdk";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection";
import type { WorkspaceFileLister } from "../workspace/WorkspaceFileLister";
import type { InteractionModeOption, SessionComposerHandle } from "../composer";
import type { ApplyResourceResult } from "../library/useApplyResource";
import { ResizableSplit } from "../internal/ResizableSplit";
import { SelectionStore } from "../internal/store/selection-store";
import { ThreadSelectionContext } from "../execution/ThreadSelectionContext";
import { useSelectedThreadItem } from "../execution/useThreadSelection";
import { MessageThread } from "../execution/MessageThread";
import { ThreadSkeleton } from "../execution/ThreadSkeleton";
import { SessionComposer } from "../composer";
import { SecretFlowErrorGuide, isSecretFlowError } from "../error";
import { useSessionPageFlow } from "./useSessionPageFlow";
import { SessionInspector } from "./inspector/SessionInspector";
import type { RuntimeEnvProvider } from "./runtime-env";
import type { SessionAudience } from "./audience";

/**
 * Message submitted when the user implements a plan. References the published
 * `plan.md` explicitly so the agent acts on the durable artifact rather than
 * relying on re-reading its own prior chat message.
 */
const IMPLEMENT_PLAN_MESSAGE =
  "Implement the plan above (saved as plan.md). Follow it step by step and make the changes it describes.";

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
   * Slot for host-injected header actions (e.g., Share button with
   * PermissionGate). Rendered in the top-right corner of the viewer.
   * Keeps the SDK organism unopinionated about Console auth (DD-004).
   */
  readonly headerActions?: ReactNode;
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
 * - **SessionInspector** (secondary): tabbed panel with Plan,
 *   Changes, Artifacts, Usage, and Inspect facets
 *
 * Connected via `ResizableSplit` with persisted width.
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
  getRuntimeEnv,
  audience = "integrator",
  headerActions,
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

  const handleBuildFromPlan = useCallback(() => {
    // Switch the picker to Agent (so subsequent turns stay in Agent) and submit
    // the implement message immediately through the composer's full pipeline.
    // `interactionMode: "agent"` is passed explicitly to win the same-tick race
    // where the composer prop has not yet re-rendered from "plan".
    setInteractionMode("agent");
    composerRef.current?.submit(IMPLEMENT_PLAN_MESSAGE, {
      interactionMode: "agent",
    });
  }, [setInteractionMode]);

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
      {headerActions && (
        <div className="absolute top-2 right-6 z-10">
          {headerActions}
        </div>
      )}

      <ThreadSelectionContext.Provider value={selectionStore}>
        <ResizableSplit
          defaultSize={384}
          minSize={280}
          maxSize={600}
          storageKey="stgm-session-inspector-width"
          className={cn(
            "min-h-0 flex-1",
            "[&>*:nth-child(2)]:max-lg:hidden [&>*:nth-child(3)]:max-lg:hidden",
          )}
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
              isEndUser={isEndUser}
            />
          }
          secondary={
            <InspectorPanel
              flow={flow}
              org={org}
              selectionStore={selectionStore}
              onApplied={onApplied}
              onImplementPlan={handleBuildFromPlan}
              enableGitHub={enableGitHub}
              enableLocal={enableLocal}
              gitHubConnection={gitHubConnection}
              onBrowseLocalFolder={onBrowseLocalFolder}
              workspaceFileLister={workspaceFileLister}
              isEndUser={isEndUser}
            />
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
  readonly isEndUser: boolean;
}

function ConversationColumn({
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
  isEndUser,
}: ConversationColumnProps) {
  const { conv } = flow;
  const sendError = flow.submitError ?? conv.sendError ?? conv.approvalError;

  // Retry a terminal-failed execution by resending its originating message
  // through the full submit pipeline (agent override, runtime-env, workspace).
  const onRetryExecution = useCallback(
    (message: string) => {
      void flow.handleSubmit(message);
    },
    [flow.handleSubmit],
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
        workspaceEntries={conv.workspaceEntries}
        sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
        onBuildFromPlan={onBuildFromPlan}
        org={org}
        planActionsDisabled={!conv.canSendFollowUp}
        centerContent
        className="flex-1"
      />
      <div className="mx-auto w-full max-w-3xl">
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
        <SessionComposer
          ref={composerRef}
          onSubmit={flow.handleSubmit}
          isSubmitting={conv.isSending}
          disabled={!conv.canSendFollowUp}
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
}

// ---------------------------------------------------------------------------
// Inspector panel (right/secondary) — reads selection from store
// ---------------------------------------------------------------------------

interface InspectorPanelProps {
  readonly flow: ReturnType<typeof useSessionPageFlow>;
  readonly org: string;
  readonly selectionStore: SelectionStore;
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Implement a plan from the Artifacts tab (same action as the thread card). */
  readonly onImplementPlan?: () => void;
  readonly enableGitHub: boolean;
  readonly enableLocal: boolean;
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
  readonly workspaceFileLister?: WorkspaceFileLister;
  readonly isEndUser: boolean;
}

function InspectorPanel({
  flow,
  org,
  selectionStore,
  onApplied,
  onImplementPlan,
  enableGitHub,
  enableLocal,
  gitHubConnection,
  onBrowseLocalFolder,
  workspaceFileLister,
  isEndUser,
}: InspectorPanelProps) {
  const selectedItem = useSelectedThreadItem();

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

  const sessionConfig = useMemo(
    () => ({
      agentRef: flow.agentRef,
      isDefaultAgent: flow.isDefaultAgent,
      mcpServerUsages: flow.mcpServerUsages,
      skillRefs: flow.skillRefs,
      sessionVariables: flow.sessionVariables,
      harness: flow.harness,
      executionTarget: flow.executionTarget,
      modelId: flow.model[0],
      // End users see the configuration but cannot strip it — the Setup
      // tab renders read-only without mutation callbacks (DD-011).
      mutations: isEndUser
        ? undefined
        : {
            onRemoveAgent: flow.isDefaultAgent ? undefined : handleRemoveAgent,
            onRemoveMcp: handleRemoveMcp,
            onRemoveSkill: handleRemoveSkill,
          },
    }),
    [
      flow.agentRef, flow.isDefaultAgent, flow.mcpServerUsages, flow.skillRefs,
      flow.sessionVariables, flow.harness, flow.executionTarget, flow.model,
      isEndUser, handleRemoveAgent, handleRemoveMcp, handleRemoveSkill,
    ],
  );

  const workspaceConfig = useMemo(
    () => ({
      actions: {
        workspace: flow.workspace,
        enableGitHub,
        enableLocal,
        gitHubConnection,
        onBrowseLocalFolder,
        workspaceFileLister,
      },
    }),
    [flow.workspace, enableGitHub, enableLocal, gitHubConnection, onBrowseLocalFolder, workspaceFileLister],
  );

  return (
    <aside className="flex h-full flex-col overflow-hidden">
      <SessionInspector
        displayExecution={flow.displayExecution}
        allExecutions={flow.allExecutions}
        org={org}
        selectedItem={selectedItem}
        onApplied={onApplied}
        onImplementPlan={onImplementPlan}
        sessionConfig={sessionConfig}
        workspaceConfig={workspaceConfig}
        className="min-h-0 flex-1"
      />
    </aside>
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
