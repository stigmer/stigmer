"use client";

import { useMemo, useState } from "react";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { BoundedContent } from "../internal/BoundedContent.js";
import { computeDiff } from "../version-history/computeDiff.js";
import { DiffViewer } from "../version-history/DiffViewer.js";
import { DiffFileList } from "../version-history/DiffFileList.js";
import { DiffSummary } from "../version-history/DiffSummary.js";
import { UnifiedDiffView } from "../version-history/UnifiedDiffView.js";
import type { DiffHunk, FileDiffEntry } from "../version-history/types.js";
import { countHunks, toFileDiffEntry } from "./deriveExecutionFileChanges.js";
import { FilePathLink } from "./FilePathLink.js";
import { EmptyChangeNotice } from "./EmptyChangeNotice.js";
import { useFileChangeContent } from "./useFileChangeContent.js";

/** Props for {@link FileChangesView}. */
export interface FileChangesViewProps {
  /**
   * Net file changes to render, typically from {@link useSessionFileChanges}.
   * One entry per changed file.
   */
  readonly changes: readonly FileChange[];
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Consolidated, GitHub-style view of the files an agent changed: a summary
 * bar, a file selector (when more than one file changed), and the unified diff
 * for the selected file.
 *
 * Renders the runner's authoritative {@link FileChange} captures directly
 * (proto-first). Whole-file captures (native) become a true before/after diff;
 * hunk-only captures (Cursor today) render their unified diff; offloaded bodies
 * are fetched lazily only when their file is opened (see {@link FileChangeDiff}).
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const { fileChanges } = useSessionFileChanges(allExecutions);
 * <FileChangesView changes={fileChanges} />
 * ```
 */
export function FileChangesView({ changes, className }: FileChangesViewProps) {
  const entries = useMemo<readonly FileDiffEntry[]>(
    () => changes.map(toFileDiffEntry),
    [changes],
  );

  const [selectedPath, setSelectedPath] = useState<string | null>(
    changes[0]?.path ?? null,
  );

  const selected =
    changes.find((c) => c.path === selectedPath) ?? changes[0] ?? null;

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, e) => ({
          additions: acc.additions + e.additions,
          deletions: acc.deletions + e.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [entries],
  );

  if (changes.length === 0 || !selected) return null;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      <DiffSummary
        fileCount={changes.length}
        additions={totals.additions}
        deletions={totals.deletions}
      />

      {changes.length > 1 && (
        <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
          <DiffFileList
            files={entries}
            selectedPath={selected.path}
            onSelect={setSelectedPath}
          />
        </div>
      )}

      <FileChangeDiff key={selected.path} change={selected} />
    </div>
  );
}

/** Props for {@link FileChangeDiff}. */
export interface FileChangeDiffProps {
  /** The single file change to render. */
  readonly change: FileChange;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
  /**
   * Optional class applied to the scrolling diff body (the `DiffViewer` table or
   * unified-diff `<pre>`). A raw height cap with no reveal control; prefer
   * {@link bounded} for the consistent clamp-and-reveal used across tool cards.
   */
  readonly bodyClassName?: string;
  /**
   * When `true`, the diff body is wrapped in the shared {@link BoundedContent}
   * primitive: clamped to the standard preview height with a bottom fade and an
   * in-place "Show more" / "Show less", identical to the always-visible
   * edit/write diff body in the timeline. Defaults to `false` so the dedicated
   * Changes view ({@link FileChangesView}) renders the full diff; the approval
   * gate opts in so a large change cannot push the decision buttons off-screen
   * while still letting the reviewer expand the whole diff in place.
   */
  readonly bounded?: boolean;
  /**
   * Whether to render the filename header (the `FilePathLink` + any rename
   * prefix). Defaults to `true`. Set to `false` where an ancestor already names
   * the file — the approval gate header, or a tool-call row — so the diff is not
   * captioned with a path the user just read; the `+N -M` stats still render.
   */
  readonly showFileName?: boolean;
  /**
   * Whether to render the `+N -M` summary. Defaults to `true`. Set to `false`
   * where an ancestor row already shows the result summary (a tool-call row) so
   * the body does not repeat the counts. Orthogonal to {@link showFileName}: the
   * approval gate suppresses the name but keeps the stats.
   */
  readonly showStats?: boolean;
}

/**
 * Renders the diff for a single {@link FileChange}, adapting to how completely
 * the runner captured it:
 *
 * - **Whole-file** (native): a true before/after diff via {@link DiffViewer}.
 *   Offloaded bodies are fetched lazily; loading, error, and too-large
 *   (server-truncated) states are surfaced honestly.
 * - **Hunk-only** (Cursor today): the captured unified diff, labeled as such.
 * - **Binary**: a "binary file changed" notice instead of a text diff.
 *
 * Importable on its own by platform builders composing custom change UIs.
 */
export function FileChangeDiff({
  change,
  className,
  bodyClassName,
  bounded = false,
  showFileName = true,
  showStats = true,
}: FileChangeDiffProps) {
  const { beforeText, afterText, isBinary, isLoading, error, isTruncated, downloadUrl } =
    useFileChangeContent(change);

  const hunks = useMemo<readonly DiffHunk[]>(() => {
    if (beforeText === null || afterText === null) return [];
    return computeDiff(beforeText, afterText);
  }, [beforeText, afterText]);

  const stats = useMemo(() => {
    if (change.captureLevel === FileChangeCaptureLevel.HUNK_ONLY) {
      return { additions: change.linesAdded, deletions: change.linesRemoved };
    }
    // Whole-file: count the rendered hunks (what the user actually sees). When
    // there are none to count — the body is offloaded/loading/truncated — fall
    // back to the capture-time counts, which are computed with the same diff
    // algorithm and so agree with the hunks whenever both exist.
    const computed = countHunks(hunks);
    if (computed.additions > 0 || computed.deletions > 0) return computed;
    return { additions: change.linesAdded, deletions: change.linesRemoved };
  }, [change.captureLevel, change.linesAdded, change.linesRemoved, hunks]);

  const showStatsRow = showStats && (stats.additions > 0 || stats.deletions > 0);

  return (
    <div
      className={cn("stg:flex stg:flex-col stg:gap-1.5", className)}
      data-cursor-target="file-diff"
    >
      {(showFileName || showStatsRow) && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground">
          {showFileName &&
            change.changeType === FileChangeType.RENAME &&
            change.renameFrom && (
              <span className="stg:min-w-0 stg:truncate stg:font-mono stg:text-muted-foreground-faint">
                {change.renameFrom} →
              </span>
            )}
          {showFileName && (
            <FilePathLink path={change.path} dirDisplay="dim" className="stg:text-xs" />
          )}
          {showStatsRow && (
            <span className="stg:shrink-0 stg:tabular-nums">
              <span className="stg:text-diff-added-fg">+{stats.additions}</span>{" "}
              <span className="stg:text-diff-removed-fg">-{stats.deletions}</span>
            </span>
          )}
        </div>
      )}

      <FileChangeBody
        change={change}
        hunks={hunks}
        isBinary={isBinary}
        isLoading={isLoading}
        error={error}
        isTruncated={isTruncated}
        downloadUrl={downloadUrl}
        bodyClassName={bodyClassName}
        bounded={bounded}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body — the capture-level / fetch-state switch
// ---------------------------------------------------------------------------

function FileChangeBody({
  change,
  hunks,
  isBinary,
  isLoading,
  error,
  isTruncated,
  downloadUrl,
  bodyClassName,
  bounded,
}: {
  change: FileChange;
  hunks: readonly DiffHunk[];
  isBinary: boolean;
  isLoading: boolean;
  error: Error | null;
  isTruncated: boolean;
  downloadUrl: string | null;
  bodyClassName?: string;
  bounded: boolean;
}) {
  // A CREATE with no renderable diff is a genuinely empty new file; anything
  // else with no content degrades to the non-committal "no preview" (we never
  // claim emptiness we cannot prove from the capture).
  const emptyKind =
    change.changeType === FileChangeType.CREATE ? "empty-create" : "no-preview";

  // When bounded, the actual diff renderers (and only those — short notices need
  // no clamp) are wrapped in the shared BoundedContent budget, so the gate's
  // diff matches the timeline edit/write diff and never crowds out the buttons.
  const bound = (node: React.ReactNode) =>
    bounded ? (
      <BoundedContent cursorTarget="file-diff-expand">{node}</BoundedContent>
    ) : (
      node
    );

  if (isBinary) {
    return <Notice>Binary file changed.</Notice>;
  }

  if (change.captureLevel === FileChangeCaptureLevel.HUNK_ONLY) {
    return change.unifiedDiff ? (
      bound(<UnifiedDiffView patch={change.unifiedDiff} className={bodyClassName} />)
    ) : (
      <EmptyChangeNotice kind={emptyKind} className={bodyClassName} />
    );
  }

  // Whole-file: content may be inline (ready) or offloaded (fetched lazily).
  if (isTruncated) {
    return (
      <Notice>
        This file is too large to diff inline.{" "}
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="stg:font-medium stg:text-primary stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            Download the full file
          </a>
        )}
      </Notice>
    );
  }

  if (isLoading) {
    return <Notice>Loading diff…</Notice>;
  }

  if (error) {
    return <Notice variant="error">Could not load this file's contents.</Notice>;
  }

  if (hunks.length === 0) {
    return <EmptyChangeNotice kind={emptyKind} className={bodyClassName} />;
  }

  return bound(<DiffViewer hunks={hunks} className={bodyClassName} />);
}

function Notice({
  children,
  variant = "muted",
}: {
  children: React.ReactNode;
  variant?: "muted" | "error";
}) {
  return (
    <div
      role="status"
      className={cn(
        "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs",
        variant === "error" ? "stg:text-destructive" : "stg:text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

// countHunks / toFileDiffEntry moved to deriveExecutionFileChanges.ts — shared
// with the workflow panel's Changes facet, which projects the same net
// FileChange list into its rail file list.
