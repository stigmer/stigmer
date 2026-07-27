"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { SurfaceRailView } from "../workspace/WorkspaceSurface.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";
import { useSessionWriteBacks } from "./useSessionWriteBacks.js";
import {
  useSessionArtifacts,
  type SessionArtifactEntry,
} from "./useSessionArtifacts.js";
import { SetupTab, type SetupTabProps } from "./facets/SetupTab.js";
import { ChangesTab } from "./facets/ChangesTab.js";
import { ArtifactsTab } from "./facets/ArtifactsTab.js";
import { UsageTab } from "./facets/UsageTab.js";

/** Options for {@link useSessionRailViews}. */
export interface UseSessionRailViewsOptions {
  /** All executions in the session — drives Changes/Artifacts/Usage. */
  readonly allExecutions: readonly AgentExecution[];
  /** Organization slug for artifact Apply CTA. */
  readonly org: string;
  /** Session configuration for the Config facet. */
  readonly sessionConfig: SetupTabProps | undefined;
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
   * Open a (non-plan) artifact as an editor-pane document tab. Routed to the
   * Artifacts facet so clicking an artifact opens it in the editor area (VS
   * Code "each file is a tab") instead of the preview modal.
   */
  readonly onOpenArtifact?: (entry: SessionArtifactEntry) => void;
  /**
   * Pin a (non-plan) artifact's document tab — the double-click half of the
   * Artifacts facet's open/activate split. Routed through to the facet's rows.
   */
  readonly onActivateArtifact?: (entry: SessionArtifactEntry) => void;
  /**
   * Whether to offer the execution-derived facets (Changes / Artifacts /
   * Usage). The launcher passes `false` — before a session exists there are no
   * executions to aggregate, so only Config applies.
   * @default true
   */
  readonly includeExecutionFacets?: boolean;
  /**
   * Whether the session is expected to push approved changes to a git remote
   * (a cloud session with git workspace entries). When `true` the Changes
   * facet is offered from the start — with an honest pre-push state — instead
   * of only materializing once a write-back exists, so "where does my work
   * go?" always has an answer (the facet's `expectsWriteBack` prop).
   * @default false
   */
  readonly expectsWriteBack?: boolean;
  /**
   * Whether the session's latest execution is settled (terminal) — forwarded
   * to the Changes facet's pre-push states (its `isSettled` prop).
   * @default false
   */
  readonly changesSettled?: boolean;
}

/**
 * Composes the session facets (Config / Changes / Artifacts / Usage)
 * as {@link SurfaceRailView}s for the workspace surface's activity rail.
 *
 * This is the session-domain half of the unified panel: the surface stays a
 * domain-pure workspace organism and these views are injected into its rail
 * (DD-004 composition). Contextual visibility mirrors the retired inspector's
 * tab rules — Changes/Artifacts surface only when data exists (with count
 * badges).
 */
export function useSessionRailViews({
  allExecutions,
  org,
  sessionConfig,
  onApplied,
  onImplementPlan,
  onOpenPlan,
  onOpenArtifact,
  onActivateArtifact,
  includeExecutionFacets = true,
  expectsWriteBack = false,
  changesSettled = false,
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
      // Offered when a write-back exists OR the session is expected to
      // produce one — the facet then carries an honest pre-push state
      // instead of being invisible until the first push.
      if (hasWriteBacks || expectsWriteBack) {
        views.push({
          id: "changes",
          label: "Changes",
          icon: <ChangesIcon />,
          badge: writeBackCount > 0 ? writeBackCount : undefined,
          content: (
            <ChangesTab
              executions={allExecutions}
              expectsWriteBack={expectsWriteBack}
              isSettled={changesSettled}
            />
          ),
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
              onOpenArtifact={onOpenArtifact}
              onActivateArtifact={onActivateArtifact}
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

    return views;
  }, [
    sessionConfig,
    includeExecutionFacets,
    expectsWriteBack,
    changesSettled,
    hasWriteBacks,
    writeBackCount,
    hasArtifacts,
    artifactCount,
    allExecutions,
    org,
    onApplied,
    onImplementPlan,
    onOpenPlan,
    onOpenArtifact,
    onActivateArtifact,
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
