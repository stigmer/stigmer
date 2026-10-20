"use client";

import { useMemo } from "react";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { SurfaceRailView } from "../workspace/WorkspaceSurface.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";
import { useSessionWriteBacks } from "./useSessionWriteBacks.js";
import type { SessionOutputEntry } from "./useSessionOutputs.js";
import type { SessionGivenEntry } from "./useSessionGivenFiles.js";
import { SetupTab, type SetupTabProps } from "./facets/SetupTab.js";
import { ChangesTab } from "./facets/ChangesTab.js";
import { FilesTab } from "./facets/FilesTab.js";
import { UsageTab } from "./facets/UsageTab.js";

const NO_OUTPUTS: readonly SessionOutputEntry[] = [];
const NO_GIVEN: readonly SessionGivenEntry[] = [];

/**
 * The rail id of the conversation's Files view. Not `files`: that id, and
 * the files icon, are the workspace surface's own Explorer (the repository
 * tree), which a conversation's Files are not part of.
 */
export const CONVERSATION_FILES_VIEW_ID = "conversation-files";

/** Options for {@link useSessionRailViews}. */
export interface UseSessionRailViewsOptions {
  /** All runs in the session — drives Changes/Usage. */
  readonly allRuns: readonly Run[];
  /**
   * What the agent saved (`useSessionOutputs` over the session's Files):
   * with {@link given}, drives the Files facet and its badge.
   */
  readonly outputs?: readonly SessionOutputEntry[];
  /** What was given to the conversation (`useSessionGivenFiles`). */
  readonly given?: readonly SessionGivenEntry[];
  /**
   * Re-read the session's Files when the Files facet opens (a stopped
   * turn's outputs register after its end).
   */
  readonly onFilesShown?: () => void;
  /** Re-read the session's Files once one is deleted from a preview. */
  readonly onFileDeleted?: () => void;
  /** Organization id for the Apply CTA (a slug is also accepted). */
  readonly org: string;
  /** Session configuration for the Config facet. */
  readonly sessionConfig: SetupTabProps | undefined;
  /** Called after a resource is applied, or a skill added, from the Files facet. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Implement a plan — the Files facet's preview action for `plan.md`. */
  readonly onImplementPlan?: () => void;
  /**
   * Open a plan in the panel's plan document tab. Routed to the Files
   * facet so clicking `plan.md` there opens the editor-area document instead
   * of the preview modal.
   */
  readonly onOpenPlan?: (executionId: string) => void;
  /**
   * Open a (non-plan) File as an editor-pane document tab, by its document
   * key. Routed to the Files facet so clicking a File opens it in the editor
   * area (VS Code "each file is a tab") instead of the preview modal.
   */
  readonly onOpenFileDocument?: (documentKey: string) => void;
  /**
   * Pin a (non-plan) File's document tab — the double-click half of the
   * Files facet's open/activate split. Routed through to the facet's rows.
   */
  readonly onActivateFileDocument?: (documentKey: string) => void;
  /**
   * Whether to offer the execution-derived facets (Changes / Files /
   * Usage). The launcher passes `false` — before a session exists there are no
   * runs to aggregate, so only Config applies.
   * @default true
   */
  readonly includeRunFacets?: boolean;
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
   * Whether the session's latest run is settled (terminal) — forwarded
   * to the Changes facet's pre-push states (its `isSettled` prop).
   * @default false
   */
  readonly changesSettled?: boolean;
}

/**
 * Composes the session facets (Config / Changes / Files / Usage)
 * as {@link SurfaceRailView}s for the workspace surface's activity rail.
 *
 * This is the session-domain half of the unified panel: the surface stays a
 * domain-pure workspace organism and these views are injected into its rail
 * (composition by injection). Contextual visibility mirrors the retired
 * inspector's tab rules — Changes/Files surface only when data exists
 * (with count badges).
 */
export function useSessionRailViews({
  allRuns,
  outputs = NO_OUTPUTS,
  given = NO_GIVEN,
  onFilesShown,
  onFileDeleted,
  org,
  sessionConfig,
  onApplied,
  onImplementPlan,
  onOpenPlan,
  onOpenFileDocument,
  onActivateFileDocument,
  includeRunFacets = true,
  expectsWriteBack = false,
  changesSettled = false,
}: UseSessionRailViewsOptions): readonly SurfaceRailView[] {
  const { hasWriteBacks, writeBackCount } = useSessionWriteBacks(allRuns);
  const fileCount = outputs.length + given.length;

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

    if (includeRunFacets) {
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
              runs={allRuns}
              expectsWriteBack={expectsWriteBack}
              isSettled={changesSettled}
            />
          ),
        });
      }

      if (fileCount > 0) {
        views.push({
          id: CONVERSATION_FILES_VIEW_ID,
          label: "Files",
          icon: <ConversationFilesIcon />,
          badge: fileCount,
          content: (
            <FilesTab
              outputs={outputs}
              given={given}
              onShown={onFilesShown}
              org={org}
              onApplied={onApplied}
              onDeleted={onFileDeleted}
              onImplementPlan={onImplementPlan}
              onOpenPlan={onOpenPlan}
              onOpenFileDocument={onOpenFileDocument}
              onActivateFileDocument={onActivateFileDocument}
            />
          ),
        });
      }

      views.push({
        id: "usage",
        label: "Usage",
        icon: <UsageIcon />,
        content: <UsageTab runs={allRuns} />,
      });
    }

    return views;
  }, [
    sessionConfig,
    includeRunFacets,
    expectsWriteBack,
    changesSettled,
    hasWriteBacks,
    writeBackCount,
    fileCount,
    outputs,
    given,
    onFilesShown,
    onFileDeleted,
    allRuns,
    org,
    onApplied,
    onImplementPlan,
    onOpenPlan,
    onOpenFileDocument,
    onActivateFileDocument,
  ]);
}

// ---------------------------------------------------------------------------
// Inline SVG icons — monochrome, `currentColor`-tinted (SDK
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

/** A stack of papers: the conversation's Files, apart from the Explorer's single file. */
function ConversationFilesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 7V4.5A1.5 1.5 0 0 1 9.5 3H15l5 5v9.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M15 3v5h5" />
      <path d="M5.5 7H11l5 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7z" />
      <path d="M11 7v5h5" />
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
