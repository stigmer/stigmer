"use client";

import { memo, useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { Tabs } from "../../tabs/Tabs.js";
import { ExecutionPhaseBadge } from "../../execution/ExecutionPhaseBadge.js";
import { useSessionArtifacts } from "../useSessionArtifacts.js";
import { useSessionWriteBacks } from "../useSessionWriteBacks.js";
import { useSessionFileChanges } from "../useSessionFileChanges.js";
import { useSessionUsage } from "../useSessionUsage.js";
import { findChangeForSelection } from "../../workspace/findChangeForSelection.js";
import { useSessionInspector } from "./useSessionInspector.js";
import { ChangesTab } from "./ChangesTab.js";
import { ArtifactsTab } from "./ArtifactsTab.js";
import { UsageTab } from "./UsageTab.js";
import { InspectTab } from "./InspectTab.js";
import { SetupTab, type SetupTabProps } from "./SetupTab.js";
import { WorkspaceTab, type WorkspaceTabProps } from "./WorkspaceTab.js";
import { FileViewer } from "../../workspace/FileViewer.js";
import type { SelectedThreadItem } from "../../internal/store/selection-store.js";
import type { SelectedWorkspaceFile } from "../../internal/store/workspace-file-selection-store.js";
import type { ApplyResourceResult } from "../../library/useApplyResource.js";

/**
 * Stable empty executions passed to {@link useSessionFileChanges} while no file
 * is open, so the (fetch-free) net-change fold stays trivial during streaming
 * and only folds once a file is actually being viewed.
 */
const EMPTY_EXECUTIONS: readonly AgentExecution[] = [];

/** Props for {@link SessionInspector}. */
export interface SessionInspectorProps {
  /**
   * The most relevant execution — the active streaming execution,
   * or the last completed one. Drives the run-status header (phase badge).
   */
  readonly displayExecution: AgentExecution | null;
  /**
   * All executions in the session (completed + active stream).
   * Drives aggregation hooks for Changes, Artifacts, and Usage.
   */
  readonly allExecutions: readonly AgentExecution[];
  /** Organization slug for artifact Apply CTA. */
  readonly org: string;
  /** Currently selected thread item, or null. */
  readonly selectedItem: SelectedThreadItem | null;
  /**
   * The workspace file open in the viewer, or null. When set, a contextual
   * "Viewer" tab surfaces and renders {@link FileViewer}. Prop-driven (like
   * `selectedItem`) so this component stays pure and memoizable; the owning
   * viewer reads the selection store and passes the result down.
   */
  readonly selectedFile?: SelectedWorkspaceFile | null;
  /**
   * Sandbox workspace root for git sessions (e.g. `/home/daytona/workspace`),
   * used to correlate a captured change path with the open file — the same
   * scalar the transcript resolver consumes. `undefined` for local-only
   * sessions. Only relevant when `selectedFile` is set.
   */
  readonly sandboxWorkspaceRoot?: string;
  /** Closes the file viewer (deselects the open file). */
  readonly onCloseFile?: () => void;
  /** Called after a resource is applied from the Artifacts tab. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Implement a plan from the Artifacts tab. When provided, plan
   * artifacts (`plan.md`) surface an Implement action in their preview.
   */
  readonly onImplementPlan?: () => void;
  /**
   * Session-level configuration for the Configure tab.
   * Includes core config fields and optional interactive
   * mutation callbacks. When mutation callbacks are absent,
   * sections render read-only (DD-011 backward compatibility).
   */
  readonly sessionConfig?: SetupTabProps;
  /**
   * Workspace tab configuration. When provided, the Workspace tab
   * renders interactive workspace actions (add/remove entries, file
   * tree browsing). When absent, the tab shows an empty state.
   */
  readonly workspaceConfig?: WorkspaceTabProps;
  /** Additional CSS classes. */
  readonly className?: string;
}

/**
 * Tabbed right-side inspector panel for agent sessions.
 *
 * Displays an always-visible run-status header (phase badge) above
 * contextual tabs: Workspace, Config, Changes, Artifacts, Usage, and
 * Inspect (when a thread item is selected). The agent's plan/todos render
 * inline in the message thread (see {@link TodoCard}), not as a tab here.
 *
 * Mirrors the `ExecutionInspector` architecture from the workflow
 * view — same `Tabs` primitive, same tab-FSM behavior hook, same
 * contextual visibility pattern.
 *
 * `React.memo`'d to prevent re-renders from parent layout changes
 * that don't affect inspector data.
 *
 * All visual properties flow through `--stgm-*` tokens. Zero
 * Console/Next/Tauri dependencies (DD-004).
 */
export const SessionInspector = memo(function SessionInspector({
  displayExecution,
  allExecutions,
  org,
  selectedItem,
  selectedFile,
  sandboxWorkspaceRoot,
  onCloseFile,
  onApplied,
  onImplementPlan,
  sessionConfig,
  workspaceConfig,
  className,
}: SessionInspectorProps) {
  const phase =
    displayExecution?.status?.phase ??
    ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  const { hasWriteBacks, writeBackCount } = useSessionWriteBacks(allExecutions);
  const { hasArtifacts, artifactCount } = useSessionArtifacts(allExecutions);
  const { hasUsage } = useSessionUsage(allExecutions);

  // Correlate the open file with the session change that touched it, so a
  // changed file defaults to its authoritative diff (Slice 4 / DD-06). The
  // net-change fold is skipped while no file is open (EMPTY_EXECUTIONS), and the
  // join reuses the same DD-08 resolver + entries + root that opened the file,
  // so "the diff shown" can never disagree with "the file opened".
  const entries = workspaceConfig?.actions.workspace.entries;
  const { fileChanges } = useSessionFileChanges(
    selectedFile ? allExecutions : EMPTY_EXECUTIONS,
  );
  const openFileChange = useMemo(
    () =>
      selectedFile && entries
        ? findChangeForSelection(selectedFile, fileChanges, entries, sandboxWorkspaceRoot)
        : null,
    [selectedFile, fileChanges, entries, sandboxWorkspaceRoot],
  );

  const { tabs, activeTab, onTabChange } = useSessionInspector({
    phase: phase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED ? null : phase,
    hasWriteBacks,
    writeBackCount,
    hasArtifacts,
    artifactCount,
    hasUsage,
    selectedItem,
    selectedFile,
  });

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Always-visible run-status header. Labeled as a region so the phase
          badge is reachable as "Execution progress" by assistive tech and
          E2E selectors, independent of which tab is active. */}
      <div
        role="region"
        aria-label="Execution progress"
        className="flex items-center gap-2 border-b border-border px-3 py-2.5"
      >
        {phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED ? (
          <ExecutionPhaseBadge phase={phase} />
        ) : (
          <span className="text-xs text-muted-foreground">No execution</span>
        )}
      </div>

      {/* Tabs + content */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        aria-label="Session details"
        className="min-h-0 flex-1"
      >
        {activeTab === "viewer" && selectedFile && workspaceConfig ? (
          // The viewer owns its own header + scroll, so it fills the panel
          // without the shared padded/scroll wrapper the other tabs use.
          <FileViewer
            key={`${selectedFile.entryId}:${selectedFile.path}`}
            selectedFile={selectedFile}
            entries={workspaceConfig.actions.workspace.entries}
            reader={workspaceConfig.actions.workspaceFileReader}
            change={openFileChange ?? undefined}
            onClose={onCloseFile}
            className="h-full"
          />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
            {activeTab === "workspace" && workspaceConfig && (
              <WorkspaceTab {...workspaceConfig} selectedFile={selectedFile ?? null} />
            )}
            {activeTab === "configure" && sessionConfig && (
              <SetupTab {...sessionConfig} />
            )}
            {activeTab === "changes" && (
              <ChangesTab executions={allExecutions} />
            )}
            {activeTab === "artifacts" && (
              <ArtifactsTab
                executions={allExecutions}
                org={org}
                onApplied={onApplied}
                onImplementPlan={onImplementPlan}
              />
            )}
            {activeTab === "usage" && (
              <UsageTab executions={allExecutions} />
            )}
            {activeTab === "inspect" && (
              <InspectTab selectedItem={selectedItem} />
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
});
