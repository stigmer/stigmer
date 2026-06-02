"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection";
import type { WorkspaceFileLister } from "../workspace/WorkspaceFileLister";
import type { InteractionModeOption } from "../composer";
import { SessionComposer } from "../composer";
import { ResizableSplit } from "../internal/ResizableSplit";
import { SessionInspector } from "./inspector/SessionInspector";
import type { SetupTabProps } from "./inspector/SetupTab";
import { useNewSessionFlow } from "./useNewSessionFlow";

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

  /** Agent to auto-select on mount (used for draft flows). */
  readonly initialAgentRef?: ResourceRef;
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
 * - **SessionInspector** (secondary pane): progressively revealed when
 *   context is attached (workspace/agent/MCP/skills/vars non-empty),
 *   showing only the Setup tab with interactive workspace actions.
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
  initialAgentRef,
  initialAttachments,
  heading = "What would you like to work on?",
  placeholder = "Describe what you need help with\u2026",
  initialRows = 3,
  autoFocus = true,
  footerContent,
  className,
}: NewSessionViewerProps) {
  const flow = useNewSessionFlow({ org, onSessionCreated, onError });
  const [interactionMode, setInteractionMode] = useState<InteractionModeOption>("agent");

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
      mutations: {
        onRemoveAgent: flow.agentRef ? handleRemoveAgent : undefined,
        onRemoveMcp: handleRemoveMcp,
        onRemoveSkill: handleRemoveSkill,
      },
    }),
    [
      flow.agentRef, flow.mcpServerUsages, flow.skillRefs,
      flow.sessionVariables, flow.harness, flow.modelId,
      handleRemoveAgent, handleRemoveMcp, handleRemoveSkill,
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
          initialAttachments={initialAttachments}
          mcpServerUsages={flow.mcpServerUsages}
          onMcpServerUsagesChange={flow.setMcpServerUsages}
          skillRefs={flow.skillRefs}
          onSkillRefsChange={flow.setSkillRefs}
          sessionVariables={flow.sessionVariables}
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

  if (!hasContext) {
    return (
      <div className={cn("flex h-full w-full flex-col", className)}>
        {composerNode}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full flex-col", className)}>
      <ResizableSplit
        defaultSize={320}
        minSize={240}
        maxSize={480}
        storageKey="stgm-new-session-inspector-width"
        className={cn(
          "min-h-0 flex-1",
          "[&>*:nth-child(2)]:max-lg:hidden [&>*:nth-child(3)]:max-lg:hidden",
        )}
        primary={composerNode}
        secondary={
          <aside className="flex h-full flex-col overflow-hidden">
            <SessionInspector
              displayExecution={null}
              allExecutions={[]}
              org={org}
              selectedItem={null}
              sessionConfig={sessionConfig}
              workspaceConfig={workspaceConfig}
              className="min-h-0 flex-1"
            />
          </aside>
        }
      />
    </div>
  );
}
