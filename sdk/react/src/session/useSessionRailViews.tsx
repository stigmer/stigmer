"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { SurfaceRailView } from "../workspace/WorkspaceSurface.js";
import type { SelectedThreadItem } from "../internal/store/selection-store.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";
import { useSessionWriteBacks } from "./useSessionWriteBacks.js";
import { useSessionArtifacts } from "./useSessionArtifacts.js";
import { SetupTab, type SetupTabProps } from "./facets/SetupTab.js";
import { ChangesTab } from "./facets/ChangesTab.js";
import { ArtifactsTab } from "./facets/ArtifactsTab.js";
import { UsageTab } from "./facets/UsageTab.js";
import { InspectTab } from "./facets/InspectTab.js";

/** Options for {@link useSessionRailViews}. */
export interface UseSessionRailViewsOptions {
  /** All executions in the session — drives Changes/Artifacts/Usage. */
  readonly allExecutions: readonly AgentExecution[];
  /** Organization slug for artifact Apply CTA. */
  readonly org: string;
  /** Session configuration for the Config facet. */
  readonly sessionConfig: SetupTabProps | undefined;
  /** Currently selected thread item — surfaces the Inspect facet. */
  readonly selectedItem: SelectedThreadItem | null;
  /** Called after a resource is applied from the Artifacts facet. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Implement a plan — the Artifacts facet's preview action for `plan.md`. */
  readonly onImplementPlan?: () => void;
  /**
   * Open a plan in the panel's plan document tab. Routed to the Artifacts
   * facet so clicking `plan.md` there opens the editor-area document instead
   * of the preview modal.
   */
  readonly onOpenPlan?: (executionId: string) => void;
  /**
   * Whether to offer the execution-derived facets (Changes / Artifacts /
   * Usage). The launcher passes `false` — before a session exists there are no
   * executions to aggregate, so only Config applies.
   * @default true
   */
  readonly includeExecutionFacets?: boolean;
}

/**
 * Composes the session facets (Config / Changes / Artifacts / Usage / Inspect)
 * as {@link SurfaceRailView}s for the workspace surface's activity rail.
 *
 * This is the session-domain half of the unified panel: the surface stays a
 * domain-pure workspace organism and these views are injected into its rail
 * (DD-004 composition). Contextual visibility mirrors the retired inspector's
 * tab rules — Changes/Artifacts surface only when data exists (with count
 * badges), Inspect only when a thread item is selected.
 */
export function useSessionRailViews({
  allExecutions,
  org,
  sessionConfig,
  selectedItem,
  onApplied,
  onImplementPlan,
  onOpenPlan,
  includeExecutionFacets = true,
}: UseSessionRailViewsOptions): readonly SurfaceRailView[] {
  const { hasWriteBacks, writeBackCount } = useSessionWriteBacks(allExecutions);
  const { hasArtifacts, artifactCount } = useSessionArtifacts(allExecutions);

  return useMemo(() => {
    const views: SurfaceRailView[] = [];

    if (sessionConfig) {
      views.push({
        id: "configure",
        label: "Config",
        icon: <GearIcon />,
        content: <SetupTab {...sessionConfig} />,
      });
    }

    if (includeExecutionFacets) {
      if (hasWriteBacks) {
        views.push({
          id: "changes",
          label: "Changes",
          icon: <ChangesIcon />,
          badge: writeBackCount,
          content: <ChangesTab executions={allExecutions} />,
        });
      }

      if (hasArtifacts) {
        views.push({
          id: "artifacts",
          label: "Artifacts",
          icon: <ArtifactsIcon />,
          badge: artifactCount,
          content: (
            <ArtifactsTab
              executions={allExecutions}
              org={org}
              onApplied={onApplied}
              onImplementPlan={onImplementPlan}
              onOpenPlan={onOpenPlan}
            />
          ),
        });
      }

      views.push({
        id: "usage",
        label: "Usage",
        icon: <UsageIcon />,
        content: <UsageTab executions={allExecutions} />,
      });
    }

    if (selectedItem) {
      views.push({
        id: "inspect",
        label: "Inspect",
        icon: <InspectIcon />,
        content: <InspectTab selectedItem={selectedItem} />,
      });
    }

    return views;
  }, [
    sessionConfig,
    includeExecutionFacets,
    hasWriteBacks,
    writeBackCount,
    hasArtifacts,
    artifactCount,
    allExecutions,
    org,
    onApplied,
    onImplementPlan,
    onOpenPlan,
    selectedItem,
  ]);
}

// ---------------------------------------------------------------------------
// Inline SVG icons — monochrome, `currentColor`-tinted (DD-005; SDK
// independence — no lucide dependency)
// ---------------------------------------------------------------------------

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Source-control style branch glyph — the session's git write-backs. */
function ChangesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 10.5a7 7 0 0 1-7 5H8.5" />
    </svg>
  );
}

function ArtifactsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v9" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 20h18" />
      <path d="M6 20v-6" />
      <path d="M11 20V9" />
      <path d="M16 20v-9" />
      <path d="M21 20V5" />
    </svg>
  );
}

/** Crosshair glyph — inspecting a selected thread item. */
function InspectIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}
