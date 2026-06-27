"use client";

import { useMemo, useState } from "react";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { computeDiff } from "../version-history/computeDiff";
import { DiffViewer } from "../version-history/DiffViewer";
import { DiffFileList } from "../version-history/DiffFileList";
import { DiffSummary } from "../version-history/DiffSummary";
import { UnifiedDiffView } from "../version-history/UnifiedDiffView";
import type { DiffHunk, FileDiffEntry } from "../version-history/types";
import { FilePathLink } from "./FilePathLink";
import { EmptyChangeNotice } from "./EmptyChangeNotice";
import { useFileChangeContent } from "./useFileChangeContent";

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
    <div className={cn("flex flex-col gap-3", className)}>
      <DiffSummary
        fileCount={changes.length}
        additions={totals.additions}
        deletions={totals.deletions}
      />

      {changes.length > 1 && (
        <div className="overflow-hidden rounded-lg border border-border">
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
   * unified-diff `<pre>`). Used to cap height where vertical space is scarce —
   * e.g. `max-h-80` at the approval gate — while the dedicated Changes view
   * leaves it unbounded.
   */
  readonly bodyClassName?: string;
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
    return countHunks(hunks);
  }, [change.captureLevel, change.linesAdded, change.linesRemoved, hunks]);

  const showStatsRow = showStats && (stats.additions > 0 || stats.deletions > 0);

  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-cursor-target="file-diff"
    >
      {(showFileName || showStatsRow) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {showFileName &&
            change.changeType === FileChangeType.RENAME &&
            change.renameFrom && (
              <span className="min-w-0 truncate font-mono text-muted-foreground-faint">
                {change.renameFrom} →
              </span>
            )}
          {showFileName && (
            <FilePathLink path={change.path} dirDisplay="dim" className="text-xs" />
          )}
          {showStatsRow && (
            <span className="shrink-0 tabular-nums">
              <span className="text-diff-added-fg">+{stats.additions}</span>{" "}
              <span className="text-diff-removed-fg">-{stats.deletions}</span>
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
}: {
  change: FileChange;
  hunks: readonly DiffHunk[];
  isBinary: boolean;
  isLoading: boolean;
  error: Error | null;
  isTruncated: boolean;
  downloadUrl: string | null;
  bodyClassName?: string;
}) {
  // A CREATE with no renderable diff is a genuinely empty new file; anything
  // else with no content degrades to the non-committal "no preview" (we never
  // claim emptiness we cannot prove from the capture).
  const emptyKind =
    change.changeType === FileChangeType.CREATE ? "empty-create" : "no-preview";

  if (isBinary) {
    return <Notice>Binary file changed.</Notice>;
  }

  if (change.captureLevel === FileChangeCaptureLevel.HUNK_ONLY) {
    return change.unifiedDiff ? (
      <UnifiedDiffView patch={change.unifiedDiff} className={bodyClassName} />
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
            className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

  return <DiffViewer hunks={hunks} className={bodyClassName} />;
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
        "rounded-md border border-border bg-muted-subtle px-3 py-2 text-xs",
        variant === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countHunks(hunks: readonly DiffHunk[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "added") additions++;
      else if (line.type === "removed") deletions++;
    }
  }
  return { additions, deletions };
}

/**
 * Projects a {@link FileChange} into a {@link FileDiffEntry} for the file list.
 *
 * Counts: hunk-only uses the runner's authoritative numbers; whole-file inline
 * is derived from the content; an offloaded whole-file side has no synchronous
 * content, so its count stays 0 until the file is opened and fetched.
 */
function toFileDiffEntry(change: FileChange): FileDiffEntry {
  const changeType =
    change.changeType === FileChangeType.CREATE
      ? "added"
      : change.changeType === FileChangeType.DELETE
        ? "removed"
        : "modified";

  if (change.captureLevel === FileChangeCaptureLevel.HUNK_ONLY) {
    return {
      path: change.path,
      changeType,
      additions: change.linesAdded,
      deletions: change.linesRemoved,
    };
  }

  const before = inlineSide(change.before);
  const after = inlineSide(change.after);
  if (before !== null && after !== null) {
    const { additions, deletions } = countHunks(computeDiff(before, after));
    return { path: change.path, changeType, additions, deletions };
  }

  return { path: change.path, changeType, additions: 0, deletions: 0 };
}

/** Inline text of a side, or null when absent/offloaded/binary. */
function inlineSide(
  side: FileChange["before"],
): string | null {
  if (!side) return "";
  if (side.isBinary) return null;
  return side.body.case === "inline" ? side.body.value : null;
}
