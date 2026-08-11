"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ResourceRef } from "@stigmer/sdk";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection.js";
import type { WorkspaceFileLister } from "../workspace/WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "../workspace/WorkspaceFileReader.js";
import type { WorkspaceContentSearcher } from "../workspace/WorkspaceContentSearcher.js";
import type { InteractionModeOption } from "../composer/index.js";
import { SessionComposer } from "../composer/index.js";
import type { HarnessOption } from "../models/harness.js";
import { SessionViewerLayout } from "./SessionViewerLayout.js";
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
   * Platform-injected content (text) searcher — the same capability
   * `SessionViewer` accepts (DD-016 parity). Desktop injects a native
   * ripgrep-backed searcher; web leaves it undefined (DD-09).
   */
  readonly workspaceContentSearcher?: WorkspaceContentSearcher;

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
   * and workspace picker remain.
   *
   * `"guest"` (anonymous visitor with a guest token) is pure chat: it
   * additionally hides the model/harness/mode pickers, attachments,
   * the workspace picker, and the session panel, binds the session to
   * `initialAgentRef` + `initialInstanceId` without any picker
   * machinery, and skips the org-level reads a guest principal cannot
   * make. Requires both `initialAgentRef` and `initialInstanceId` —
   * a guest launcher never falls back to the org default agent.
   *
   * See {@link SessionAudience}.
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
 *   Config rail view — collapsed by default behind a persistent top-right chip
 *   and homing on the Config facet when opened. Same layout model as
 *   `SessionViewer` (DD-016).
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
  workspaceContentSearcher,
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
    audience,
  });
  const [interactionMode, setInteractionMode] = useState<InteractionModeOption>("agent");
  const isGuest = audience === "guest";
  // Both curated audiences (endUser, guest) lock the agent and hide the
  // integrator pickers; guest adds its own restrictions below.
  const isCurated = audience !== "integrator";

  // Guest agent binding is host configuration, not a picker interaction:
  // the composer's agent machinery (picker, env-collection, personal
  // environments — all org reads a guest token cannot make) stays fully
  // unwired, and the launcher pins the flow to the shared agent's
  // instance directly. Without the pin, submission fails closed in
  // useNewSessionFlow rather than falling back to the org default agent.
  const { setAgentRef, setResolution } = flow;
  useEffect(() => {
    if (!isGuest || !initialAgentRef || !initialInstanceId) return;
    setAgentRef(initialAgentRef);
    setResolution({ mode: "saved", instanceId: initialInstanceId });
  }, [isGuest, initialAgentRef, initialInstanceId, setAgentRef, setResolution]);

  // The unified-panel controller (shared with SessionViewer, DD-016). The
  // launcher has no execution yet, so the FSM inputs are static. It has no
  // streaming column to isolate either, so subscribing to the editor group in
  // the body is harmless — unlike `SessionViewer`, which subscribes one level
  // down. Homes on Config: pre-session the Explorer is empty, while Config
  // carries the run defaults (harness/model) worth seeing before starting.
  const panel = useSessionPanel({
    phase: null,
    hasChanges: false,
    defaultView: "configure",
  });
  const { editors, activeKey, activeFile, reveal } = useWorkspaceEditors(
    panel.editorsStore,
  );

  // Honor a jump-to-line reveal only while it targets the active editor
  // (DD-016 parity with SessionViewer).
  const activeReveal =
    reveal && reveal.key === activeKey ? reveal : undefined;

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
      // Curated audiences see the configuration but cannot strip it — the
      // Setup tab renders read-only without mutation callbacks (DD-011).
      mutations: isCurated
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
      isCurated, handleRemoveAgent, handleRemoveMcp, handleRemoveSkill,
    ],
  );

  // Launcher facets: Config only — no executions exist yet, so the
  // execution-derived facets (Changes/Artifacts/Usage) don't apply.
  const railViews = useSessionRailViews({
    allExecutions: [],
    org,
    sessionConfig,
    includeExecutionFacets: false,
  });

  // Explorer-footer folder attach (desktop only — needs the native picker).
  const canAddLocalFolder = enableLocal && !!onBrowseLocalFolder;
  const handleAddLocalFolder = useCallback(async () => {
    const path = await onBrowseLocalFolder?.();
    if (path) flow.workspace.addLocalPath(path);
  }, [onBrowseLocalFolder, flow.workspace.addLocalPath]);

  const composerNode = (
    // `my-auto` centers the composer vertically whether or not context is
    // attached — safe-centering, not a special case: auto margins absorb free
    // space when the composer is shorter than the pane and collapse to zero
    // when it outgrows it, degrading to a normal top-aligned scroll. The
    // scroll container's `py-6` keeps breathing room in that overflow case.
    // Do NOT reintroduce a context-driven position flip: the composer must not
    // move as context is attached (DD-16's layout-stability rationale — chrome
    // that shifts with attached context reads as instability).
    <div className="stg:flex stg:h-full stg:flex-col stg:items-center stg:overflow-y-auto stg:px-4 stg:py-6">
      <div className="stg:my-auto stg:w-full stg:max-w-2xl stg:space-y-6">
        <h1 className="stg:text-center stg:text-lg stg:font-medium stg:text-foreground">
          {heading}
        </h1>

        <SessionComposer
          onSubmit={flow.submit}
          isSubmitting={flow.isSubmitting}
          org={org}
          workspace={isGuest ? undefined : flow.workspace}
          gitHubConnection={enableGitHub && !isGuest ? gitHubConnection : undefined}
          enableGitHub={enableGitHub && !isGuest}
          enableLocal={enableLocal && !isGuest}
          onBrowseLocalFolder={onBrowseLocalFolder}
          agentRef={flow.agentRef}
          // Guests get no agent machinery at all — the binding is applied
          // by the launcher's pin effect above, not by picker resolution.
          onAgentRefChange={isGuest ? undefined : flow.setAgentRef}
          onAgentResolutionChange={isGuest ? undefined : flow.setResolution}
          initialAgentRef={isGuest ? undefined : initialAgentRef}
          initialInstanceId={isGuest ? undefined : initialInstanceId}
          initialAttachments={isGuest ? undefined : initialAttachments}
          lockAgent={isCurated && initialAgentRef != null}
          mcpServerUsages={isCurated ? undefined : flow.mcpServerUsages}
          onMcpServerUsagesChange={isCurated ? undefined : flow.setMcpServerUsages}
          skillRefs={isCurated ? undefined : flow.skillRefs}
          onSkillRefsChange={isCurated ? undefined : flow.setSkillRefs}
          sessionVariables={isCurated ? undefined : flow.sessionVariables}
          showHarnessSelector={!isGuest}
          harness={flow.harness}
          onHarnessChange={flow.setHarness}
          interactionMode={interactionMode}
          onInteractionModeChange={setInteractionMode}
          showInteractionModePicker={!isGuest}
          showModelSelector={!isGuest}
          enableAttachments={!isGuest}
          defaultModelId={flow.modelId}
          onModelChange={flow.setModelId}
          placeholder={placeholder}
          initialRows={initialRows}
          autoFocus={autoFocus}
          ariaLabel="Start a new session"
        />

        {footerContent}

        <p className="stg:text-center stg:text-[0.65rem] stg:text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );

  return (
    // The launcher renders the same SessionViewerLayout as SessionViewer
    // (DD-016) — the shared frame is what makes "the two viewers behave
    // identically" structural rather than hand-synchronized.
    <SessionViewerLayout
      className={className}
      resizeAriaLabel="Resize composer panel"
      splitStorageKey="stgm-new-session-chat-width"
      // Persistent chrome: the chip is always mounted, matching SessionViewer
      // (DD-016) rather than the launcher's earlier progressively-revealed
      // inspector. A toggle that appears/disappears with attached context
      // reads as instability and, worse, unmounts the open panel's only
      // collapse control when the last context item is removed. Always-on is
      // the predictable, discoverable shape; opening homes on the Config
      // facet, which carries useful defaults (harness/model) pre-session.
      // Guests are the exception: the panel exposes configuration a visitor
      // has no business with, so the chip (the panel's only toggle) is
      // simply absent and the panel can never open.
      chip={
        !isGuest ? (
          <SessionPanelChip
            isOpen={panel.isOpen}
            onToggle={panel.isOpen ? panel.closePanel : panel.openPanel}
          />
        ) : undefined
      }
      conversation={composerNode}
      panel={
        panel.isOpen ? (
          <WorkspaceSurface
            entries={flow.workspace.entries}
            lister={workspaceFileLister}
            reader={workspaceFileReader}
            searcher={workspaceContentSearcher}
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
            reveal={activeReveal}
            className="stg:h-full"
          />
        ) : null
      }
    />
  );
}
