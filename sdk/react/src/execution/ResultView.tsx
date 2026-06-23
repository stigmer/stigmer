"use client";

// Renders a normalized ToolResultView (from @stigmer/sdk) with a semantic view
// per result type — diffs, terminals, search lists, file content, MCP content
// blocks — instead of a raw JSON dump. The json/text variants are the graceful
// fallbacks, so unknown tools are still readable.

import { useMemo, useState } from "react";
import type {
  ToolResultView,
  ToolSearchMatch,
  ToolContentBlock,
} from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { computeDiff } from "../version-history/computeDiff";
import type { DiffHunk } from "../version-history/types";
import { CollapsibleCode, CollapsiblePre, formatJson } from "./tool-rendering-primitives";
import { FilePathLink } from "./FilePathLink";
import { useSandboxNormalize } from "./SandboxContext";
import { execIdFromStorageKey } from "./useFileChangeContent";
import { useArtifactDownloadUrl } from "./useArtifactDownloadUrl";
import { useArtifactDownload } from "./useArtifactDownload";
import { useToolOutputContent } from "./useToolOutputContent";

/** Props for {@link ResultView}. */
export interface ResultViewProps {
  /** The normalized result view to render. */
  readonly view: ToolResultView;
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
export function ResultView({ view, className }: ResultViewProps) {
  switch (view.type) {
    case "diff":
      return <DiffResultView view={view} className={className} />;
    case "terminal":
      return <TerminalResultView view={view} className={className} />;
    case "search":
      return <SearchResultView matches={view.matches} count={view.count} className={className} />;
    case "list":
      return <ListResultView entries={view.entries} count={view.count} className={className} />;
    case "file":
      return <FileResultView view={view} className={className} />;
    case "contentBlocks":
      return <ContentBlocksResultView blocks={view.blocks} className={className} />;
    case "outputRef":
      return <OutputRefResultView view={view} className={className} />;
    case "text":
      return view.text ? <CollapsiblePre content={view.text} className={cn("text-foreground", className)} /> : null;
    case "json":
      return <CollapsibleCode label="Result" content={formatJson(view.value)} className={className} />;
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
      return `${view.count} ${view.count === 1 ? "match" : "matches"}`;
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

function DiffResultView({ view, className }: { view: DiffView; className?: string }) {
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

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2 text-muted-foreground">
        {view.path && <FilePathLink path={view.path} className="text-xs" />}
        {stats && (
          <span className="shrink-0 tabular-nums text-xs">
            <span className="text-success">+{stats.added}</span>{" "}
            <span className="text-destructive">-{stats.removed}</span>
          </span>
        )}
      </div>

      {hunks.length > 0 ? (
        <DiffHunks hunks={hunks} />
      ) : view.unifiedDiff ? (
        <UnifiedDiffText patch={view.unifiedDiff} />
      ) : null}
    </div>
  );
}

function DiffHunks({ hunks }: { hunks: readonly DiffHunk[] }) {
  return (
    <div className="overflow-auto rounded-md border border-border bg-muted-subtle font-mono text-xs">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="border-b border-border-muted last:border-b-0">
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={cn(
                "whitespace-pre-wrap break-words px-2 py-0.5",
                line.type === "added" && "bg-success-subtle text-success",
                line.type === "removed" && "bg-destructive-subtle text-destructive",
                line.type === "context" && "text-muted-foreground",
              )}
            >
              {/* Screen readers get the change type as words; sighted users get
                  the +/- sign and color. Never color-only. */}
              {line.type !== "context" && (
                <span className="sr-only">
                  {line.type === "added" ? "Added: " : "Removed: "}
                </span>
              )}
              <span className="select-none" aria-hidden="true">
                {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Renders a raw unified-diff patch string (Cursor envelope) with +/- coloring.
function UnifiedDiffText({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted-subtle p-2 font-mono text-xs">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") && "text-success",
            line.startsWith("-") && !line.startsWith("---") && "text-destructive",
            line.startsWith("@@") && "text-primary",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

type TerminalView = Extract<ToolResultView, { type: "terminal" }>;

function TerminalResultView({ view, className }: { view: TerminalView; className?: string }) {
  const normalize = useSandboxNormalize();
  const failed = view.exitCode !== undefined && view.exitCode !== 0;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-muted-foreground">Output</span>
        {view.exitCode !== undefined && (
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[10px] font-medium leading-none tabular-nums",
              failed ? "bg-destructive-subtle text-destructive" : "bg-success-subtle text-success",
            )}
          >
            exit {view.exitCode}
          </span>
        )}
      </div>
      <div className="rounded-md border border-border bg-[var(--stgm-terminal-bg,#1a1a2e)] p-2.5">
        {view.stdout && (
          <CollapsiblePre
            content={normalize(view.stdout)}
            className="text-[var(--stgm-terminal-fg,#e0e0e0)]"
          />
        )}
        {view.stderr && (
          <CollapsiblePre
            content={normalize(view.stderr)}
            className="text-destructive"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search / List
// ---------------------------------------------------------------------------

function SearchResultView({
  matches,
  count,
  className,
}: {
  matches: readonly ToolSearchMatch[];
  count: number;
  className?: string;
}) {
  if (count === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>No matches</p>;
  }
  return (
    <div className={cn("space-y-1", className)}>
      <span className="font-medium text-muted-foreground">
        {count} {count === 1 ? "match" : "matches"}
      </span>
      <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted-subtle font-mono text-xs">
        {matches.map((m, i) => (
          <div key={i} className="whitespace-pre-wrap break-words border-b border-border-muted px-2 py-0.5 text-foreground last:border-b-0">
            {m.file && <span className="text-primary">{m.file}{m.line !== undefined ? `:${m.line}` : ""} </span>}
            <span className={m.file ? "text-muted-foreground" : "text-foreground"}>{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListResultView({
  entries,
  count,
  className,
}: {
  entries: readonly string[];
  count: number;
  className?: string;
}) {
  if (count === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>Empty</p>;
  }
  return (
    <div className={cn("space-y-1", className)}>
      <span className="font-medium text-muted-foreground">
        {count} {count === 1 ? "item" : "items"}
      </span>
      <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted-subtle font-mono text-xs">
        {entries.map((e, i) => (
          <div key={i} className="truncate px-2 py-0.5 text-foreground">
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

function FileResultView({ view, className }: { view: FileView; className?: string }) {
  if (!view.content) {
    return view.path ? (
      <div className={cn("flex items-center gap-1.5 text-xs", className)}>
        <FilePathLink path={view.path} className="text-xs" />
      </div>
    ) : null;
  }
  return (
    <div className={cn("space-y-1", className)}>
      {view.path && <FilePathLink path={view.path} className="text-xs" />}
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
  return <CollapsiblePre content={text} className={cn("text-foreground", className)} />;
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
    return <p className={cn("text-xs text-destructive", className)}>Couldn&apos;t load image output.</p>;
  }
  if (!url) {
    return (
      <div
        className={cn("h-40 w-64 animate-pulse rounded-md border border-border bg-muted", className)}
        aria-busy="true"
        aria-label="Loading image output"
      />
    );
  }
  return (
    <div className={cn("space-y-1", className)}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={url}
          alt="Tool output screenshot"
          loading="lazy"
          className="max-h-96 w-auto rounded-md border border-border"
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
    <div className={cn("space-y-1", className)}>
      {!expanded ? (
        <>
          {view.preview && (
            <CollapsiblePre content={view.preview} className="text-foreground" />
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View full output{sizeSuffix}
          </button>
        </>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Loading full output…</p>
      ) : error ? (
        <p className="text-xs text-destructive">Couldn&apos;t load full output. Try again.</p>
      ) : content !== null ? (
        <div className="space-y-1">
          <CollapsiblePre content={content} className="text-foreground" />
          {isTruncated && (
            <button
              type="button"
              onClick={() => download(view.storageKey)}
              disabled={isDownloading}
              className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
    <div className={cn("space-y-1", className)}>
      <span className="font-medium text-destructive">Error</span>
      <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/20 bg-destructive-subtle p-2 font-mono text-destructive">
        {message}
      </pre>
    </div>
  );
}
