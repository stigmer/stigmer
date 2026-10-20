"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { outputKey, type SessionOutputEntry } from "../useSessionOutputs.js";
import { givenKey, type SessionGivenEntry } from "../useSessionGivenFiles.js";
import { UNSTYLED_LIST } from "../../internal/element-resets.js";
import { FilePreviewModal } from "../../run/FilePreviewModal.js";
import { FileRow } from "../../run/FileRow.js";
import { FileRowView } from "../../run/FileRowView.js";
import { useFileDownload } from "../../file/useFile.js";
import { formatRelativeTime } from "../../activity/format-relative-time.js";
import { isPlanFile } from "../../library/detect-plan-artifact.js";
import type { ApplyResourceResult } from "../../library/useApplyResource.js";

export interface FilesTabProps {
  /** What the agent saved, one entry per output path (`useSessionOutputs`). */
  readonly outputs: readonly SessionOutputEntry[];
  /** What was given to the conversation, newest first (`useSessionGivenFiles`). */
  readonly given: readonly SessionGivenEntry[];
  readonly org: string;
  /**
   * Called once when the tab opens, to re-read the conversation's Files: a
   * stopped turn's outputs register after its end, and nothing else
   * announces them.
   */
  readonly onShown?: () => void;
  /** Called after a resource is applied, or a `.zip` File added as a skill. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Called once a File is deleted from a preview. When provided, the
   * preview offers Delete to a caller holding `can_delete` on the File.
   */
  readonly onDeleted?: () => void;
  /**
   * Implement a plan. When provided, the preview of a plan File
   * shows an Implement action (turn the plan into a Run) — the same
   * action as the message-thread plan card.
   */
  readonly onImplementPlan?: () => void;
  /**
   * Open a plan in the session panel's plan document tab. When provided, a
   * plan File routes there instead of the preview modal — the plan
   * is a first-class document, not a popup. Other Files keep the
   * modal. When omitted (hosts without the plan tab) the modal remains for
   * every File.
   */
  readonly onOpenPlan?: (executionId: string) => void;
  /**
   * Open a File as an editor-pane document (the session panel's File
   * document family — the VS Code "each file is a tab" model), by its
   * document key ({@link outputKey} or {@link givenKey}). When provided,
   * clicking a row routes here instead of the preview modal. When omitted
   * (panel-less hosts) the modal remains the open mechanism. Plans always
   * defer to {@link onOpenPlan} first.
   */
  readonly onOpenFileDocument?: (documentKey: string) => void;
  /**
   * Pin a File's document tab — the double-click half of the open/activate
   * split (mirrors the file tree's `onOpenFile`/`onActivateFile`). When
   * provided, each row binds a double-click that promotes the preview the
   * single click opened. Omit in panel-less/modal hosts: with no handler the
   * row binds no double-click, so a double-click is just two harmless single
   * clicks. Plans always route to {@link onOpenPlan} (their tab is already
   * pinned), so double-click == single-click for a plan.
   */
  readonly onActivateFileDocument?: (documentKey: string) => void;
}

/** A File shown in the preview modal, with whether its turn has ended. */
interface Preview {
  readonly file: StigmerFile;
  readonly isTerminal: boolean;
}

/**
 * The conversation's Files, for the session panel (a `useSessionRailViews`
 * rail view), in two groups:
 *
 * - **Saved by the agent**: one compact {@link FileRow} per output path,
 *   the newest turn's File winning; the earlier versions at a path sit
 *   behind a disclosure on its row, each with its turn's time, and open in
 *   the preview modal.
 * - **Given to the conversation**: every File no turn returned (uploads,
 *   attached folders, a routine's or the Library's Files), newest first,
 *   each named by where the agent finds it.
 *
 * Clicking a row opens the File — a plan in the plan document tab
 * ({@link onOpenPlan}), any other File in an editor-pane document
 * ({@link onOpenFileDocument}), or, for panel-less hosts that inject
 * neither, the {@link FilePreviewModal} popup fallback.
 *
 * Deliberately metadata-only: rows do NOT fetch content or ask permissions
 * (that would be one request per File on open) — detection, Apply, Delete
 * and "Add as skill" live in the opened document/modal instead.
 */
export function FilesTab({
  outputs,
  given,
  org,
  onShown,
  onApplied,
  onDeleted,
  onImplementPlan,
  onOpenPlan,
  onOpenFileDocument,
  onActivateFileDocument,
}: FilesTabProps) {
  const [preview, setPreview] = useState<Preview | null>(null);

  // Once per opening: the facet mounts when its rail view is shown. The ref
  // keeps a host's new callback identity from re-reading on every render.
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  useEffect(() => {
    onShownRef.current?.();
  }, []);

  const openOutput = useCallback(
    (entry: SessionOutputEntry) => {
      // A plan is a first-class document — it opens in the dedicated plan tab,
      // never as a generic File or a popup.
      if (onOpenPlan && isPlanFile(entry.file)) {
        onOpenPlan(entry.runId);
        return;
      }
      if (onOpenFileDocument) {
        onOpenFileDocument(outputKey(entry.file));
        return;
      }
      setPreview({ file: entry.file, isTerminal: entry.isTerminal });
    },
    [onOpenPlan, onOpenFileDocument],
  );

  const activateOutput = useCallback(
    (entry: SessionOutputEntry) => {
      // A plan's tab is always pinned, so double-click matches single-click.
      if (onOpenPlan && isPlanFile(entry.file)) {
        onOpenPlan(entry.runId);
        return;
      }
      onActivateFileDocument?.(outputKey(entry.file));
    },
    [onOpenPlan, onActivateFileDocument],
  );

  const openGiven = useCallback(
    (entry: SessionGivenEntry) => {
      if (onOpenFileDocument) {
        onOpenFileDocument(givenKey(entry));
        return;
      }
      setPreview({ file: entry.file, isTerminal: true });
    },
    [onOpenFileDocument],
  );

  const handleDeleted = useCallback(() => {
    setPreview(null);
    onDeleted?.();
  }, [onDeleted]);

  if (outputs.length === 0 && given.length === 0) {
    return (
      <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:px-4 stg:py-8 stg:text-center">
        <p className="stg:text-xs stg:text-muted-foreground">
          No files yet. Files you give the conversation, and files the agent saves for you, appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      {outputs.length > 0 && (
        <FileGroup title="Saved by the agent">
          {outputs.map((entry) => (
            <OutputRow
              key={outputKey(entry.file)}
              entry={entry}
              onOpen={() => openOutput(entry)}
              onActivate={onActivateFileDocument ? () => activateOutput(entry) : undefined}
              onOpenEarlier={(file) => setPreview({ file, isTerminal: true })}
            />
          ))}
        </FileGroup>
      )}

      {given.length > 0 && (
        <FileGroup title="Given to the conversation">
          {given.map((entry) => (
            <FileRow
              key={entry.file.metadata?.id ?? givenKey(entry)}
              file={entry.file}
              place={entry.place}
              onOpen={() => openGiven(entry)}
              onActivate={
                onActivateFileDocument ? () => onActivateFileDocument(givenKey(entry)) : undefined
              }
            />
          ))}
        </FileGroup>
      )}

      {preview && (
        <FilePreviewModal
          file={preview.file}
          isTerminal={preview.isTerminal}
          org={org}
          open
          onClose={() => setPreview(null)}
          onApplied={onApplied}
          onDeleted={onDeleted ? handleDeleted : undefined}
          onImplement={isPlanFile(preview.file) ? onImplementPlan : undefined}
        />
      )}
    </>
  );
}

function FileGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="stg:flex stg:flex-col stg:pb-2">
      <h3 className="stg:px-2 stg:pb-1 stg:pt-2 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wide stg:text-muted-foreground-faint">
        {title}
      </h3>
      <ul role="list" className={`${UNSTYLED_LIST} stg:flex stg:flex-col`}>
        {children}
      </ul>
    </section>
  );
}

/**
 * One output path: its newest File's row and, when earlier turns saved the
 * same path, a disclosure over their versions.
 */
function OutputRow({
  entry,
  onOpen,
  onActivate,
  onOpenEarlier,
}: {
  readonly entry: SessionOutputEntry;
  readonly onOpen: () => void;
  readonly onActivate?: () => void;
  readonly onOpenEarlier: (file: StigmerFile) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = entry.earlier.length;
  return (
    <>
      <FileRow
        file={entry.file}
        hasNameCollision={entry.hasNameCollision}
        onOpen={onOpen}
        onActivate={onActivate}
      />
      {count > 0 && (
        <li className="stg:flex stg:flex-col">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="stg:self-start stg:px-2 stg:pb-1 stg:pl-8 stg:text-[0.65rem] stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring"
          >
            {expanded ? "Hide" : "Show"} {count} earlier {count === 1 ? "version" : "versions"}
          </button>
          {expanded && (
            <ul role="list" aria-label={`Earlier versions of ${entry.file.spec?.filename ?? ""}`} className={`${UNSTYLED_LIST} stg:flex stg:flex-col stg:pl-6`}>
              {entry.earlier.map((file) => (
                <EarlierVersionRow key={file.metadata?.id ?? ""} file={file} onOpen={() => onOpenEarlier(file)} />
              ))}
            </ul>
          )}
        </li>
      )}
    </>
  );
}

/** An earlier version at an output path: named by its turn's time. */
function EarlierVersionRow({ file, onOpen }: { readonly file: StigmerFile; readonly onOpen: () => void }) {
  const { download, isDownloading } = useFileDownload();
  const created = file.status?.audit?.specAudit?.createdAt;
  const filename = file.spec?.filename ?? "";
  return (
    <FileRowView
      item={{
        name: filename,
        tooltip: file.status?.outputPath || filename,
        subtitlePath: created ? savedLabel(timestampDate(created)) : null,
        sizeBytes: file.status?.sizeBytes ?? BigInt(0),
      }}
      onOpen={onOpen}
      onDownload={() => download(file.metadata?.id ?? "", filename)}
      isDownloading={isDownloading}
    />
  );
}

/** "saved 3h ago", "saved just now", or "saved Jul 12" once the age is a date. */
function savedLabel(date: Date): string {
  const age = formatRelativeTime(date);
  if (age === "now") return "saved just now";
  return /^\d+[mhd]$/.test(age) ? `saved ${age} ago` : `saved ${age}`;
}
