"use client";

// Renders a normalized ToolResultView (from @stigmer/sdk) with a semantic view
// per result type — diffs, terminals, search lists, file content, MCP content
// blocks — instead of a raw JSON dump. The json/text variants are the graceful
// fallbacks, so unknown tools are still readable.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ToolResultView,
  ToolSearchMatch,
  ToolContentBlock,
} from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { computeDiff } from "../version-history/computeDiff.js";
import { DiffViewer } from "../version-history/DiffViewer.js";
import { UnifiedDiffView } from "../version-history/UnifiedDiffView.js";
import type { DiffHunk } from "../version-history/types.js";
import { CollapsibleCode, CollapsiblePre, formatJson } from "./tool-rendering-primitives.js";
import { FilePathLink } from "./FilePathLink.js";
import { EmptyChangeNotice } from "./EmptyChangeNotice.js";
import { TerminalSession } from "./TerminalSession.js";
import { execIdFromStorageKey } from "./useFileChangeContent.js";
import { useArtifactDownloadUrl } from "./useArtifactDownloadUrl.js";
import { useArtifactDownload } from "./useArtifactDownload.js";
import { useToolOutputContent } from "./useToolOutputContent.js";

/** Props for {@link ResultView}. */
export interface ResultViewProps {
  /** The normalized result view to render. */
  readonly view: ToolResultView;
  /**
   * Whether the file/diff variants render the filename header. Defaults to
   * `true`. Set to `false` where an ancestor already names the file (a tool-call
   * row whose header shows the path) so the body is not captioned with a path
   * the user just read; the `+N -M` stats still render.
   */
  readonly showFileName?: boolean;
  /**
   * Whether the result body renders its headline summary stat — the diff's
   * `+N -M`, or a search/list's `N files` / `N matches` / `N items` count.
   * Defaults to `true`. Set to `false` where an ancestor row already shows the
   * summary (a tool-call row that renders `summarizeResultView`) so the body does
   * not repeat the count the user just read. A search/list still surfaces a
   * truncation note when suppressed, since that is information the row header does
   * not carry. Orthogonal to {@link showFileName}: the approval gate suppresses
   * the name but keeps the stats.
   */
  readonly showStats?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a {@link ToolResultView} with a type-appropriate treatment.
 *
 * This is the presentation half of the tool-result pipeline: `@stigmer/sdk`'s
 * `normalizeToolResult` turns an opaque result string into a typed view, and
 * this component renders it. Importable on its own by platform builders who
 * compose custom tool UIs.
 */
export function ResultView({ view, showFileName = true, showStats = true, className }: ResultViewProps) {
  switch (view.type) {
    case "diff":
      return <DiffResultView view={view} showFileName={showFileName} showStats={showStats} className={className} />;
    case "terminal":
      return <TerminalResultView view={view} className={className} />;
    case "search":
      return <SearchResultView view={view} showCount={showStats} className={className} />;
    case "list":
      return <ListResultView entries={view.entries} count={view.count} showCount={showStats} className={className} />;
    case "file":
      return <FileResultView view={view} showFileName={showFileName} className={className} />;
    case "contentBlocks":
      return <ContentBlocksResultView blocks={view.blocks} className={className} />;
    case "outputRef":
      return <OutputRefResultView view={view} className={className} />;
    case "text":
      return view.text ? <CollapsiblePre content={view.text} className={cn("stg:text-foreground", className)} /> : null;
    case "json":
      return <CollapsibleCode label="Result" content={formatJson(view.value)} className={className} />;
    case "memoryProposal":
      // Fallback for consumers composing ResultView directly: the verbatim
      // proposed fact (DD-005 D6 — never paraphrased). The consent chip
      // (Confirm/Reject, live lifecycle state) is the thread's primary
      // surface for this view and renders it in place of this.
      return <CollapsiblePre content={view.fact} className={cn("stg:text-foreground", className)} />;
    case "error":
      return <ErrorResultView message={view.message} className={className} />;
    case "empty":
      return null;
  }
}

/**
 * Returns a compact one-line summary fragment for a result view, suitable for a
 * collapsed tool row (e.g. "+40 -0", "exit 1", "2 matches"). Returns null when
 * there is nothing useful to summarize.
 */
export function summarizeResultView(view: ToolResultView): string | null {
  switch (view.type) {
    case "diff": {
      const stats = diffStats(view);
      return stats ? `+${stats.added} -${stats.removed}` : null;
    }
    case "terminal":
      return view.exitCode !== undefined && view.exitCode !== 0 ? `exit ${view.exitCode}` : null;
    case "search":
      return searchCountLabel(view.count, view.kind);
    case "list":
      return `${view.count} ${view.count === 1 ? "item" : "items"}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

type DiffView = Extract<ToolResultView, { type: "diff" }>;

interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

function countHunks(hunks: readonly DiffHunk[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "added") added++;
      else if (line.type === "removed") removed++;
    }
  }
  return { added, removed };
}

// Used by the collapsed-row summary, where no precomputed hunks are available.
// Prefers the engine-provided counts (Cursor envelope) and only runs the diff
// algorithm for the native harness, which provides none.
function diffStats(view: DiffView): DiffStats | null {
  if (view.linesAdded !== undefined || view.linesRemoved !== undefined) {
    return { added: view.linesAdded ?? 0, removed: view.linesRemoved ?? 0 };
  }
  if (view.oldText !== undefined && view.newText !== undefined) {
    return countHunks(computeDiff(view.oldText, view.newText));
  }
  return null;
}

function DiffResultView({
  view,
  showFileName = true,
  showStats = true,
  className,
}: {
  view: DiffView;
  showFileName?: boolean;
  showStats?: boolean;
  className?: string;
}) {
  // The native engine returns no diff, so we compute hunks from args (old/new).
  // The Cursor envelope provides a ready unified-diff string we render directly.
  const hunks = useMemo<readonly DiffHunk[]>(() => {
    if (view.oldText !== undefined && view.newText !== undefined) {
      return computeDiff(view.oldText, view.newText);
    }
    return [];
  }, [view.oldText, view.newText]);

  // Derive stats from the already-computed hunks instead of re-running the diff.
  const stats = useMemo<DiffStats | null>(() => {
    if (view.linesAdded !== undefined || view.linesRemoved !== undefined) {
      return { added: view.linesAdded ?? 0, removed: view.linesRemoved ?? 0 };
    }
    return hunks.length > 0 ? countHunks(hunks) : null;
  }, [view.linesAdded, view.linesRemoved, hunks]);

  const showPath = showFileName && Boolean(view.path);
  const showStatsRow = showStats && stats != null;

  // One diff family across every surface: computed hunks render through the
  // canonical, accessible DiffViewer (line numbers + --stgm-diff-* tokens); a
  // ready hunk-only patch (Cursor envelope) is parsed into the same DiffViewer
  // table by UnifiedDiffView (raw fallback only if unparseable). The header
  // (path + ± stats) is this view's own, so the DiffViewer is used without its
  // filePath header to avoid a duplicate path.
  return (
    <div className={cn("stg:space-y-1", className)} data-cursor-target="file-diff">
      {(showPath || showStatsRow) && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-muted-foreground">
          {showPath && (
            <FilePathLink path={view.path} dirDisplay="dim" className="stg:text-xs" />
          )}
          {showStatsRow && stats && (
            <span className="stg:shrink-0 stg:tabular-nums stg:text-xs">
              <span className="stg:text-diff-added-fg">+{stats.added}</span>{" "}
              <span className="stg:text-diff-removed-fg">-{stats.removed}</span>
            </span>
          )}
        </div>
      )}

      {hunks.length > 0 ? (
        <DiffViewer hunks={hunks} />
      ) : view.unifiedDiff ? (
        <UnifiedDiffView patch={view.unifiedDiff} />
      ) : (
        <EmptyChangeNotice kind="no-preview" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

type TerminalView = Extract<ToolResultView, { type: "terminal" }>;

// A shell result IS a terminal session: the command prompt line plus its
// output, rendered as one block by the shared TerminalSession (no separate
// "Output" caption or command box).
function TerminalResultView({ view, className }: { view: TerminalView; className?: string }) {
  return (
    <TerminalSession
      command={view.command}
      stdout={view.stdout}
      stderr={view.stderr}
      exitCode={view.exitCode}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// Search / List
// ---------------------------------------------------------------------------

type SearchView = Extract<ToolResultView, { type: "search" }>;

/** "N files" / "N matches" — the noun follows the search subtype. */
function searchCountLabel(count: number, kind: SearchView["kind"]): string {
  if (kind === "files") {
    return `${count} ${count === 1 ? "file" : "files"}`;
  }
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

/**
 * Renders a search result with a subtype-aware treatment.
 *
 * - **File-name search** (`kind: "files"` — glob / file_search): the matches are
 *   paths, rendered as a clickable {@link FilePathLink} list (filename-first,
 *   full path on hover, opens on GitHub or copies locally).
 * - **Content search** (`kind: "content"` — grep): the matches are lines,
 *   grouped under their file with `line: text` rows; matches with no file
 *   association (the native grep shape) render as a flat monospace list.
 *
 * The count header uses the engine's authoritative `count` (which can exceed the
 * returned matches when `truncated`), and a "showing first N" note makes a
 * capped result honest instead of silently partial. Empty results name the
 * subtype ("No files found" vs "No matches") — the query lives in the owning row
 * header, so it is not restated here.
 */
function SearchResultView({
  view,
  showCount = true,
  className,
}: {
  view: SearchView;
  showCount?: boolean;
  className?: string;
}) {
  const { matches, count, kind, truncated } = view;

  if (count === 0 && matches.length === 0) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        {kind === "files" ? "No files found" : "No matches"}
      </p>
    );
  }

  // The owning row header already shows the count (summarizeResultView), so when
  // suppressed the body shows only the truncation note — the one fact the header
  // does not carry. When standalone (showCount), it leads with the full count.
  const header = showCount
    ? `${searchCountLabel(count, kind)}${truncated ? ` \u00b7 showing first ${matches.length}` : ""}`
    : truncated
      ? `Showing first ${matches.length} of ${count}`
      : null;

  return (
    <div className={cn("stg:space-y-1", className)}>
      {header && <span className="stg:font-medium stg:text-muted-foreground">{header}</span>}
      {kind === "files" ? (
        <SearchFileList matches={matches} />
      ) : (
        <SearchContentMatches matches={matches} />
      )}
    </div>
  );
}

/** Bounded, scrollable shell shared by both search result treatments. */
function SearchResultBox({ children }: { children: ReactNode }) {
  return (
    <div className="stg:max-h-80 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:text-xs">
      {children}
    </div>
  );
}

/** A clickable list of file-name search hits. */
function SearchFileList({ matches }: { matches: readonly ToolSearchMatch[] }) {
  return (
    <SearchResultBox>
      {matches.map((m, i) => (
        <div
          key={i}
          className="stg:border-b stg:border-border-muted stg:px-2 stg:py-0.5 stg:last:border-b-0"
        >
          <FilePathLink path={m.file ?? m.text} dirDisplay="dim" className="stg:text-xs" />
        </div>
      ))}
    </SearchResultBox>
  );
}

/** Content (grep) matches, grouped under their file when one is provided. */
function SearchContentMatches({ matches }: { matches: readonly ToolSearchMatch[] }) {
  const groups = useMemo(() => groupMatchesByFile(matches), [matches]);
  return (
    <SearchResultBox>
      {groups.map((group, gi) => (
        <div key={gi} className="stg:border-b stg:border-border-muted stg:last:border-b-0">
          {group.file && (
            <div className="stg:bg-muted-faint stg:px-2 stg:py-0.5">
              <FilePathLink path={group.file} dirDisplay="dim" className="stg:text-xs" />
            </div>
          )}
          {group.matches.map((m, i) => (
            <div
              key={i}
              className="stg:whitespace-pre-wrap stg:break-words stg:px-2 stg:py-0.5 stg:font-mono stg:text-foreground"
            >
              {m.line !== undefined && (
                <span className="stg:select-none stg:text-muted-foreground-subtle">{m.line}: </span>
              )}
              {m.text}
            </div>
          ))}
        </div>
      ))}
    </SearchResultBox>
  );
}

interface MatchGroup {
  readonly file?: string;
  readonly matches: ToolSearchMatch[];
}

/**
 * Groups consecutive matches that share a file into one group, preserving order.
 * Matches with no file association fall into their own file-less group so the
 * native grep shape (line text only) still renders as a flat list.
 */
function groupMatchesByFile(matches: readonly ToolSearchMatch[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (const m of matches) {
    const last = groups[groups.length - 1];
    if (last && last.file === m.file) {
      last.matches.push(m);
    } else {
      groups.push({ file: m.file, matches: [m] });
    }
  }
  return groups;
}

function ListResultView({
  entries,
  count,
  showCount = true,
  className,
}: {
  entries: readonly string[];
  count: number;
  showCount?: boolean;
  className?: string;
}) {
  if (count === 0) {
    return <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>Empty</p>;
  }
  return (
    <div className={cn("stg:space-y-1", className)}>
      {showCount && (
        <span className="stg:font-medium stg:text-muted-foreground">
          {count} {count === 1 ? "item" : "items"}
        </span>
      )}
      <div className="stg:max-h-80 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:font-mono stg:text-xs">
        {entries.map((e, i) => (
          <div key={i} className="stg:truncate stg:px-2 stg:py-0.5 stg:text-foreground">
            {e}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File / content blocks / error
// ---------------------------------------------------------------------------

type FileView = Extract<ToolResultView, { type: "file" }>;

function FileResultView({
  view,
  showFileName = true,
  className,
}: {
  view: FileView;
  showFileName?: boolean;
  className?: string;
}) {
  if (!view.content) {
    // No body. When the filename is shown elsewhere (showFileName=false), an
    // empty write fallback degrades honestly to a neutral notice rather than a
    // bare, redundant path; otherwise the path itself is the information (a read).
    if (showFileName && view.path) {
      return (
        <div className={cn("stg:flex stg:items-center stg:gap-1.5 stg:text-xs", className)}>
          <FilePathLink path={view.path} className="stg:text-xs" />
        </div>
      );
    }
    return showFileName ? null : (
      <EmptyChangeNotice kind="no-preview" className={className} />
    );
  }
  return (
    <div className={cn("stg:space-y-1", className)}>
      {showFileName && view.path && (
        <FilePathLink path={view.path} className="stg:text-xs" />
      )}
      <CollapsibleCode label={view.truncated ? "Content (truncated)" : "Content"} content={view.content} />
    </div>
  );
}

function ContentBlocksResultView({
  blocks,
  className,
}: {
  blocks: readonly ToolContentBlock[];
  className?: string;
}) {
  const text = useMemo(
    () =>
      blocks
        .map((b) => (b.type === "text" && b.text ? b.text : `[${b.type}]`))
        .join("\n"),
    [blocks],
  );
  return <CollapsiblePre content={text} className={cn("stg:text-foreground", className)} />;
}

// ---------------------------------------------------------------------------
// Offloaded output (ToolCallOutputRef)
// ---------------------------------------------------------------------------

type OutputRefView = Extract<ToolResultView, { type: "outputRef" }>;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Renders a tool result whose bytes were offloaded to artifact storage. The
 * bytes are resolved on demand from the stable `storageKey` at view time — the
 * URL once baked into the persisted status expired after an hour, so it is no
 * longer trusted. Images (e.g. computer-use screenshots) render inline via a
 * freshly minted URL; other large output expands its full text in-app, with a
 * download fallback when the server truncates it.
 */
function OutputRefResultView({ view, className }: { view: OutputRefView; className?: string }) {
  if (view.isImage) {
    return <OutputRefImage storageKey={view.storageKey} className={className} />;
  }
  return <OutputRefText view={view} className={className} />;
}

/** Offloaded image output, rendered from an always-fresh presigned URL. */
function OutputRefImage({ storageKey, className }: { storageKey: string; className?: string }) {
  const executionId = useMemo(() => execIdFromStorageKey(storageKey), [storageKey]);
  const { url, error } = useArtifactDownloadUrl(executionId, storageKey);

  if (error) {
    return <p className={cn("stg:text-xs stg:text-destructive", className)}>Couldn&apos;t load image output.</p>;
  }
  if (!url) {
    return (
      <div
        className={cn("stg:h-40 stg:w-64 stg:animate-pulse stg:rounded-md stg:border stg:border-border stg:bg-muted", className)}
        aria-busy="true"
        aria-label="Loading image output"
      />
    );
  }
  return (
    <div className={cn("stg:space-y-1", className)}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="stg:inline-block stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
      >
        <img
          src={url}
          alt="Tool output screenshot"
          loading="lazy"
          className="stg:max-h-96 stg:w-auto stg:rounded-md stg:border stg:border-border"
        />
      </a>
    </div>
  );
}

/**
 * Offloaded text output. Shows a preview head with a "View full output" toggle
 * that lazily fetches the full content in-app (CORS-safe). If the server
 * truncates it, offers a full download via a freshly minted URL.
 */
function OutputRefText({ view, className }: { view: OutputRefView; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const executionId = useMemo(() => execIdFromStorageKey(view.storageKey), [view.storageKey]);
  const { content, isLoading, isTruncated, error } = useToolOutputContent(
    { storageKey: view.storageKey, contentHash: view.contentHash },
    expanded,
  );
  const { download, isDownloading } = useArtifactDownload(executionId);

  const sizeSuffix = view.sizeBytes ? ` (${formatBytes(view.sizeBytes)})` : "";

  return (
    <div className={cn("stg:space-y-1", className)}>
      {!expanded ? (
        <>
          {view.preview && (
            <CollapsiblePre content={view.preview} className="stg:text-foreground" />
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="stg:inline-block stg:text-xs stg:font-medium stg:text-primary stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            View full output{sizeSuffix}
          </button>
        </>
      ) : isLoading ? (
        <p className="stg:text-xs stg:text-muted-foreground">Loading full output…</p>
      ) : error ? (
        <p className="stg:text-xs stg:text-destructive">Couldn&apos;t load full output. Try again.</p>
      ) : content !== null ? (
        <div className="stg:space-y-1">
          <CollapsiblePre content={content} className="stg:text-foreground" />
          {isTruncated && (
            <button
              type="button"
              onClick={() => download(view.storageKey)}
              disabled={isDownloading}
              className="stg:inline-block stg:text-xs stg:font-medium stg:text-primary stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:disabled:opacity-50"
            >
              {isDownloading ? "Preparing download…" : `Output truncated — download full file${sizeSuffix}`}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ErrorResultView({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn("stg:space-y-1", className)}>
      <span className="stg:font-medium stg:text-destructive">Error</span>
      <pre className="stg:whitespace-pre-wrap stg:break-words stg:rounded-md stg:border stg:border-destructive/20 stg:bg-destructive-subtle stg:p-2 stg:font-mono stg:text-destructive">
        {message}
      </pre>
    </div>
  );
}
