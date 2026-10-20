"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { outputKey, type SessionOutputEntry } from "../useSessionOutputs.js";
import { UNSTYLED_LIST } from "../../internal/element-resets.js";
import { FilePreviewModal } from "../../run/FilePreviewModal.js";
import { FileRow } from "../../run/FileRow.js";
import { isPlanFile } from "../../library/detect-plan-artifact.js";
import type { ApplyResourceResult } from "../../library/useApplyResource.js";

export interface FilesTabProps {
  /** The conversation's outputs, one per output path (`useSessionOutputs`). */
  readonly artifacts: readonly SessionOutputEntry[];
  readonly org: string;
  /**
   * Called once when the tab opens, to re-read the conversation's Files: a
   * stopped turn's outputs register after its end, and nothing else
   * announces them.
   */
  readonly onShown?: () => void;
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Implement a plan. When provided, the preview of a plan File
   * shows an Implement action (turn the plan into a Run) — the same
   * action as the message-thread plan card.
   */
  readonly onImplementPlan?: () => void;
  /**
   * Open a plan in the session panel's plan document tab. When provided, a
   * plan File routes there instead of the preview modal — the plan
   * is a first-class document, not a popup. Non-plan artifacts keep the
   * modal. When omitted (hosts without the plan tab) the modal remains for
   * every artifact.
   */
  readonly onOpenPlan?: (executionId: string) => void;
  /**
   * Open an artifact as an editor-pane document (the session panel's
   * artifact-family virtual-document tab — the VS Code "each file is a tab"
   * model). When provided, clicking a non-plan artifact routes here instead of
   * the preview modal. When omitted (panel-less hosts) the modal remains the
   * open mechanism. Plan artifacts always defer to {@link onOpenPlan} first.
   */
  readonly onOpenArtifact?: (entry: SessionOutputEntry) => void;
  /**
   * Pin a non-plan artifact's document tab — the double-click half of the
   * open/activate split (mirrors the file tree's `onOpenFile`/`onActivateFile`).
   * When provided, each row binds a double-click that promotes the preview the
   * single click opened. Omit in panel-less/modal hosts: with no handler the
   * row binds no double-click, so a double-click is just two harmless single
   * clicks. Plans always route to {@link onOpenPlan} (their tab is already
   * pinned), so double-click == single-click for a plan.
   */
  readonly onActivateArtifact?: (entry: SessionOutputEntry) => void;
}

/**
 * Artifacts facet for the session panel (a `useSessionRailViews` rail view).
 *
 * A VS Code-style dense file list of the session's outputs (the Files its
 * turns returned): one compact {@link FileRow} per output path (shared
 * file-type icon + name + size, with a hover/focus Download). Clicking a row
 * opens the File — a plan in the
 * plan document tab ({@link onOpenPlan}), any other artifact in an editor-pane
 * document ({@link onOpenArtifact}), or, for panel-less hosts that inject
 * neither, the {@link FilePreviewModal} popup fallback.
 *
 * Deliberately metadata-only: rows do NOT fetch content for resource detection
 * (that would be one request per File on open) — detection and the Apply
 * action live in the opened document/modal instead.
 */
export function FilesTab({
  artifacts,
  org,
  onShown,
  onApplied,
  onImplementPlan,
  onOpenPlan,
  onOpenArtifact,
  onActivateArtifact,
}: FilesTabProps) {
  const hasArtifacts = artifacts.length > 0;
  const [previewEntry, setPreviewEntry] = useState<SessionOutputEntry | null>(null);

  // Once per opening: the facet mounts when its rail view is shown. The ref
  // keeps a host's new callback identity from re-reading on every render.
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  useEffect(() => {
    onShownRef.current?.();
  }, []);

  const handleOpen = useCallback(
    (entry: SessionOutputEntry) => {
      // A plan is a first-class document — it opens in the dedicated plan tab,
      // never as a generic artifact or a popup.
      if (onOpenPlan && isPlanFile(entry.file)) {
        onOpenPlan(entry.runId);
        return;
      }
      // Editor-pane document when the host injected it; otherwise the modal.
      if (onOpenArtifact) {
        onOpenArtifact(entry);
        return;
      }
      setPreviewEntry(entry);
    },
    [onOpenPlan, onOpenArtifact],
  );

  const handleActivate = useCallback(
    (entry: SessionOutputEntry) => {
      // A plan's tab is always pinned, so double-click matches single-click:
      // route to the plan tab, never pin a generic artifact.
      if (onOpenPlan && isPlanFile(entry.file)) {
        onOpenPlan(entry.runId);
        return;
      }
      onActivateArtifact?.(entry);
    },
    [onOpenPlan, onActivateArtifact],
  );

  const handleClosePreview = useCallback(() => {
    setPreviewEntry(null);
  }, []);

  if (!hasArtifacts) {
    return (
      <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:px-4 stg:py-8 stg:text-center">
        <p className="stg:text-xs stg:text-muted-foreground">
          No artifacts yet. Files the agent saves for you will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul role="list" className={`${UNSTYLED_LIST} stg:flex stg:flex-col`}>
        {artifacts.map((entry) => (
          <FileRow
            key={outputKey(entry.file)}
            file={entry.file}
            hasNameCollision={entry.hasNameCollision}
            onOpen={() => handleOpen(entry)}
            onActivate={
              onActivateArtifact ? () => handleActivate(entry) : undefined
            }
          />
        ))}
      </ul>

      {previewEntry && (
        <FilePreviewModal
          file={previewEntry.file}
          isTerminal={previewEntry.isTerminal}
          org={org}
          open
          onClose={handleClosePreview}
          onApplied={onApplied}
          onImplement={
            isPlanFile(previewEntry.file) ? onImplementPlan : undefined
          }
        />
      )}
    </>
  );
}
