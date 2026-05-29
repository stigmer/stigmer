"use client";

import { memo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { Tabs } from "../../tabs/Tabs";
import { ExecutionPhaseBadge } from "../../execution/ExecutionPhaseBadge";
import { useSessionArtifacts } from "../useSessionArtifacts";
import { useSessionWriteBacks } from "../useSessionWriteBacks";
import { useSessionUsage } from "../useSessionUsage";
import { useSessionInspector } from "./useSessionInspector";
import { PlanTab } from "./PlanTab";
import { ChangesTab } from "./ChangesTab";
import { ArtifactsTab } from "./ArtifactsTab";
import { UsageTab } from "./UsageTab";
import { InspectTab } from "./InspectTab";
import { SetupTab, type SetupTabProps } from "./SetupTab";
import type { SelectedThreadItem } from "../../internal/store/selection-store";
import type { ApplyResourceResult } from "../../library/useApplyResource";

/** Props for {@link SessionInspector}. */
export interface SessionInspectorProps {
  /**
   * The most relevant execution — the active streaming execution,
   * or the last completed one. Drives the run-status header and
   * the Plan facet.
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
  /** Called after a resource is applied from the Artifacts tab. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Session-level configuration for the Setup tab.
   * Includes core config fields and optional interactive workspace
   * actions / mutation callbacks. When mutation callbacks are absent,
   * sections render read-only (DD-011 backward compatibility).
   */
  readonly sessionConfig?: SetupTabProps;
  /** Additional CSS classes. */
  readonly className?: string;
}

/**
 * Tabbed right-side inspector panel for agent sessions.
 *
 * Displays an always-visible run-status header (phase badge) above
 * contextual tabs: Plan, Changes, Artifacts, Usage, and Inspect
 * (when a thread item is selected).
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
  onApplied,
  sessionConfig,
  className,
}: SessionInspectorProps) {
  const phase =
    displayExecution?.status?.phase ??
    ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  const { hasWriteBacks, writeBackCount } = useSessionWriteBacks(allExecutions);
  const { hasArtifacts, artifactCount } = useSessionArtifacts(allExecutions);
  const { hasUsage } = useSessionUsage(allExecutions);

  const { tabs, activeTab, onTabChange } = useSessionInspector({
    phase: phase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED ? null : phase,
    hasWriteBacks,
    writeBackCount,
    hasArtifacts,
    artifactCount,
    hasUsage,
    selectedItem,
  });

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Always-visible run-status header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
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
        <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
          {activeTab === "plan" && (
            <PlanTab execution={displayExecution} />
          )}
          {activeTab === "changes" && (
            <ChangesTab executions={allExecutions} />
          )}
          {activeTab === "artifacts" && (
            <ArtifactsTab
              executions={allExecutions}
              org={org}
              onApplied={onApplied}
            />
          )}
          {activeTab === "usage" && (
            <UsageTab executions={allExecutions} />
          )}
          {activeTab === "setup" && sessionConfig && (
            <SetupTab {...sessionConfig} />
          )}
          {activeTab === "inspect" && (
            <InspectTab selectedItem={selectedItem} />
          )}
        </div>
      </Tabs>
    </div>
  );
});
