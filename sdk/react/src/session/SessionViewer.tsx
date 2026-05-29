"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection";
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
  headerActions,
  onApplied,
  className,
}: SessionViewerProps) {
  const flow = useSessionPageFlow({ sessionId, org });
  const { conv } = flow;

  const [modelId, setModelId] = flow.model;
  const [interactionMode, setInteractionMode] = useState<InteractionModeOption>("agent");
  const composerRef = useRef<SessionComposerHandle>(null);

  const selectionStoreRef = useRef<SelectionStore | null>(null);
  if (!selectionStoreRef.current) {
    selectionStoreRef.current = new SelectionStore();
  }
  const selectionStore = selectionStoreRef.current;

  const handleBuildFromPlan = useCallback(() => {
    setInteractionMode("agent");
    composerRef.current?.setMessage("Implement the plan above");
    composerRef.current?.focus();
  }, []);

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
            />
          }
          secondary={
            <InspectorPanel
              flow={flow}
              org={org}
              selectionStore={selectionStore}
              onApplied={onApplied}
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
}: ConversationColumnProps) {
  const { conv } = flow;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <MessageThread
        executions={conv.completedExecutions}
        activeStreamExecution={conv.activeStreamExecution}
        pendingUserMessage={conv.pendingUserMessage}
        onApprovalSubmit={conv.submitApproval}
        submittingApprovalIds={conv.submittingApprovalIds}
        workspaceEntries={conv.workspaceEntries}
        sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
        onBuildFromPlan={onBuildFromPlan}
        centerContent
        className="flex-1"
      />
      <div className="mx-auto w-full max-w-3xl">
        {conv.streamError && (
          <StreamErrorBanner
            error={conv.streamError}
            onReconnect={conv.reconnectStream}
          />
        )}
        {(conv.sendError || conv.approvalError) && (
          <SendErrorBanner error={(conv.sendError ?? conv.approvalError)!} />
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
          mcpServerUsages={flow.mcpServerUsages}
          onMcpServerUsagesChange={flow.setMcpServerUsages}
          skillRefs={flow.skillRefs}
          onSkillRefsChange={flow.setSkillRefs}
          sessionVariables={flow.sessionVariables}
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
}

function InspectorPanel({ flow, org, selectionStore, onApplied }: InspectorPanelProps) {
  const selectedItem = useSelectedThreadItem();

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
    }),
    [flow.agentRef, flow.isDefaultAgent, flow.mcpServerUsages, flow.skillRefs, flow.sessionVariables, flow.harness, flow.executionTarget, flow.model],
  );

  return (
    <aside className="flex h-full flex-col overflow-hidden">
      <SessionInspector
        displayExecution={flow.displayExecution}
        allExecutions={flow.allExecutions}
        org={org}
        selectedItem={selectedItem}
        onApplied={onApplied}
        sessionConfig={sessionConfig}
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
