"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection.js";
import type { WorkspaceFileLister } from "../workspace/WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "../workspace/WorkspaceFileReader.js";
import type { InteractionModeOption } from "../composer/index.js";
import { SessionComposer } from "../composer/index.js";
import type { HarnessOption } from "../models/harness.js";
import { ResizableSplit } from "../internal/ResizableSplit.js";
import { useWorkspaceEditors } from "../internal/store/index.js";
import { WorkspaceSurface } from "../workspace/WorkspaceSurface.js";
import type { SetupTabProps } from "./facets/SetupTab.js";
import { useNewSessionFlow } from "./useNewSessionFlow.js";
import { useSessionPanel } from "./useSessionPanel.js";
import { useSessionRailViews } from "./useSessionRailViews.js";
import { SessionPanelChip } from "./SessionPanelChip.js";
import type { RuntimeEnvProvider } from "./runtime-env.js";
import type { SessionAudience } from "./audience.js";

/** Props for {@link NewSessionViewer}. */
export interface NewSessionViewerProps {
  /** Organization slug. Required for session creation. */
  readonly org: string;
  /** Called after the session and first execution are created. */
  readonly onSessionCreated: (sessionId: string) => void;
  /** Called on error (for toast notifications or other UI feedback). */
  readonly onError?: (message: string) => void;

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
   * Platform-injected file lister for workspace entries. When provided,
   * each entry in the Setup tab's workspace section renders an
   * expandable file tree. (DD-004 capability injection, DD-011 opt-in.)
   */
  readonly workspaceFileLister?: WorkspaceFileLister;

  /**
   * Platform-injected content reader for the read-only file viewer. When set,
   * clicking a file in the Workspace tree opens it in a contextual "Viewer"
   * tab — the same capability `SessionViewer` accepts (DD-016 parity).
   */
  readonly workspaceFileReader?: WorkspaceFileReader;

  /**
   * Supplies host-app environment variables for the session's first
   * execution (e.g. short-lived credentials for MCP tools, minted as
   * the signed-in user). Evaluated at submit time, before the session
   * is created; host values win over composer-collected env on key
   * collisions. If the provider throws, the submission fails with an
   * error surfaced via `onError` — see {@link RuntimeEnvProvider}.
   */
  readonly getRuntimeEnv?: RuntimeEnvProvider;

  /**
   * Presentation audience for the launcher. `"endUser"` locks the
   * pinned agent (when `initialAgentRef` is set) and hides the MCP
   * server, skill, and session-variable pickers — for product-embedded
   * chat where the agent is configured upstream by the platform. The
   * model selector, interaction mode, harness selector, attachments,
   * and workspace picker remain. See {@link SessionAudience}.
   *
   * @default "integrator"
   */
  readonly audience?: SessionAudience;

  /**
   * Harness pre-selected for new sessions when the user has not made
   * an explicit choice yet. The user can still switch before starting
   * the session, and their explicit choice wins on subsequent visits.
   *
   * @default "native"
   */
  readonly defaultHarness?: HarnessOption;

  /** Agent to auto-select on mount (used for draft flows). */
  readonly initialAgentRef?: ResourceRef;
  /**
   * Pre-bind the new session to a specific `AgentInstance` on mount.
   *
   * Requires `initialAgentRef`. When both are set, the session is created
   * against this exact configured deployment (the env-collection flow is
   * skipped because the instance already binds its environment). Powers the
   * "Start session" action on the Agent detail page's Instances tab.
   */
  readonly initialInstanceId?: string;
  /** Files to auto-attach on mount (used for edit flows). */
  readonly initialAttachments?: File[];

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
   * about Console-specific error rendering (DD-004).
   */
  readonly footerContent?: ReactNode;

  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Full-featured new-session launcher organism — the pre-session analog
 * of `SessionViewer`.
 *
 * Owns `useNewSessionFlow` internally and composes:
 * - **Centered composer** (primary pane): `SessionComposer` with all
 *   context pickers (agent, workspace, MCP servers, skills)
 * - **Session panel** (secondary pane): the unified `WorkspaceSurface` with a
 *   Config rail view — collapsed by default behind a top-right chip that
 *   appears once context is attached (workspace/agent/MCP/skills/vars
 *   non-empty). Same layout model as `SessionViewer` (DD-016).
 *
 * Framework-agnostic — no Next.js, no Tauri, no routing deps. Host
 * apps inject platform-specific values via props (DD-004/DD-016).
 *
 * @example
 * ```tsx
 * // Desktop
 * <NewSessionViewer
 *   org={org}
 *   onSessionCreated={(id) => navigate(`/sessions/${id}`)}
 *   onError={(msg) => toast.error(msg)}
 *   enableLocal
 *   onBrowseLocalFolder={browseLocalFolder}
 * />
 *
 * // Web
 * <NewSessionViewer
 *   org={org}
 *   onSessionCreated={navigateToSession}
 *   onError={(msg) => toast.error(msg)}
 *   enableGitHub
 *   gitHubConnection={gitHubConnection}
 * />
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
  workspaceFileLister,
  workspaceFileReader,
  getRuntimeEnv,
  audience = "integrator",
  defaultHarness,
  initialAgentRef,
  initialInstanceId,
  initialAttachments,
  heading = "What would you like to work on?",
  placeholder = "Describe what you need help with\u2026",
  initialRows = 3,
  autoFocus = true,
  footerContent,
  className,
}: NewSessionViewerProps) {
  const flow = useNewSessionFlow({
    org,
    onSessionCreated,
    onError,
    getRuntimeEnv,
    defaultHarness,
  });
  const [interactionMode, setInteractionMode] = useState<InteractionModeOption>("agent");
  const isEndUser = audience === "endUser";

  // The unified-panel controller (shared with SessionViewer, DD-016). The
  // launcher has no execution yet, so the FSM inputs are static. It has no
  // streaming column to isolate either, so subscribing to the editor group in
  // the body is harmless — unlike `SessionViewer`, which subscribes one level
  // down.
  const panel = useSessionPanel({ phase: null, hasChanges: false });
  const { editors, activeFile } = useWorkspaceEditors(panel.editorsStore);

  const hasContext =
    flow.workspace.hasEntries ||
    flow.agentRef !== null ||
    flow.mcpServerUsages.length > 0 ||
    flow.skillRefs.length > 0 ||
    (flow.sessionVariables != null && !flow.sessionVariables.isEmpty);

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

  const sessionConfig: SetupTabProps = useMemo(
    () => ({
      agentRef: flow.agentRef,
      isDefaultAgent: false,
      mcpServerUsages: flow.mcpServerUsages,
      skillRefs: flow.skillRefs,
      sessionVariables: flow.sessionVariables,
      harness: flow.harness,
      executionTarget: undefined,
      modelId: flow.modelId,
      // End users see the configuration but cannot strip it — the Setup
      // tab renders read-only without mutation callbacks (DD-011).
      mutations: isEndUser
        ? undefined
        : {
            onRemoveAgent: flow.agentRef ? handleRemoveAgent : undefined,
            onRemoveMcp: handleRemoveMcp,
            onRemoveSkill: handleRemoveSkill,
          },
    }),
    [
      flow.agentRef, flow.mcpServerUsages, flow.skillRefs,
      flow.sessionVariables, flow.harness, flow.modelId,
      isEndUser, handleRemoveAgent, handleRemoveMcp, handleRemoveSkill,
    ],
  );

  // Launcher facets: Config only — no executions exist yet, so the
  // execution-derived facets (Changes/Artifacts/Usage) don't apply.
  const railViews = useSessionRailViews({
    allExecutions: [],
    org,
    sessionConfig,
    selectedItem: null,
    includeExecutionFacets: false,
  });

  // Explorer-footer folder attach (desktop only — needs the native picker).
  const canAddLocalFolder = enableLocal && !!onBrowseLocalFolder;
  const handleAddLocalFolder = useCallback(async () => {
    const path = await onBrowseLocalFolder?.();
    if (path) flow.workspace.addLocalPath(path);
  }, [onBrowseLocalFolder, flow.workspace.addLocalPath]);

  const composerNode = (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4">
      <div className={cn(
        "w-full max-w-2xl space-y-6",
        hasContext ? "my-6" : "my-auto",
      )}>
        <h1 className="text-center text-lg font-medium text-foreground">
          {heading}
        </h1>

        <SessionComposer
          onSubmit={flow.submit}
          isSubmitting={flow.isSubmitting}
          org={org}
          workspace={flow.workspace}
          gitHubConnection={enableGitHub ? gitHubConnection : undefined}
          enableGitHub={enableGitHub}
          enableLocal={enableLocal}
          onBrowseLocalFolder={onBrowseLocalFolder}
          agentRef={flow.agentRef}
          onAgentRefChange={flow.setAgentRef}
          onAgentResolutionChange={flow.setResolution}
          initialAgentRef={initialAgentRef}
          initialInstanceId={initialInstanceId}
          initialAttachments={initialAttachments}
          lockAgent={isEndUser && initialAgentRef != null}
          mcpServerUsages={isEndUser ? undefined : flow.mcpServerUsages}
          onMcpServerUsagesChange={isEndUser ? undefined : flow.setMcpServerUsages}
          skillRefs={isEndUser ? undefined : flow.skillRefs}
          onSkillRefsChange={isEndUser ? undefined : flow.setSkillRefs}
          sessionVariables={isEndUser ? undefined : flow.sessionVariables}
          showHarnessSelector
          harness={flow.harness}
          onHarnessChange={flow.setHarness}
          interactionMode={interactionMode}
          onInteractionModeChange={setInteractionMode}
          showInteractionModePicker
          defaultModelId={flow.modelId}
          onModelChange={flow.setModelId}
          placeholder={placeholder}
          initialRows={initialRows}
          autoFocus={autoFocus}
          ariaLabel="Start a new session"
        />

        {footerContent}

        <p className="text-center text-[0.65rem] text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );

  return (
    <div className={cn("relative flex h-full w-full flex-col", className)}>
      {/* The panel chip appears once there is context worth inspecting —
          the launcher's successor to the old progressively-revealed inspector.
          The composer's own pickers already confirm attached context inline. */}
      {hasContext && (
        <div className="absolute top-2 right-6 z-10">
          <SessionPanelChip
            isOpen={panel.isOpen}
            onToggle={panel.isOpen ? panel.closePanel : panel.openPanel}
          />
        </div>
      )}

      {/* Same unified-panel layout as SessionViewer (DD-016): collapsed by
          default (composer fills the row); opening makes the composer the
          fixed narrow pane and hands the flexible region to the surface.
          Collapse goes through the split's `collapsedPane` (CSS, not
          conditional structure), so the composer never remounts — even when
          `hasContext` flips. */}
      <ResizableSplit
        resizablePane="primary"
        collapsedPane={panel.isOpen ? "none" : "secondary"}
        defaultSize={420}
        minSize={320}
        maxSize={640}
        storageKey="stgm-new-session-chat-width"
        responsiveCollapse={panel.isOpen ? "primary" : "none"}
        ariaLabel="Resize composer panel"
        className="min-h-0 flex-1"
        primary={composerNode}
        secondary={
          panel.isOpen ? (
            <WorkspaceSurface
              entries={flow.workspace.entries}
              lister={workspaceFileLister}
              reader={workspaceFileReader}
              view={panel.view}
              onViewChange={panel.setView}
              extraViews={railViews}
              onRemoveEntry={flow.workspace.remove}
              onAddLocalFolder={canAddLocalFolder ? handleAddLocalFolder : undefined}
              editors={editors}
              selectedFile={activeFile}
              onOpenFile={panel.openFile}
              onActivateEditor={panel.activateEditor}
              onPinEditor={panel.pinEditor}
              onCloseEditor={panel.closeEditor}
              onCollapse={panel.closePanel}
              className="h-full"
            />
          ) : null
        }
      />
    </div>
  );
}
