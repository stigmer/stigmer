"use client";

import { useContext, useMemo, useState, type ReactNode } from "react";
import type { CapturedFileChange } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { editAttemptOf, formatElapsed, isBackgroundRunning, lineRangeWords, toDisplayFileChange } from "@stigmer/client";
import type { ToolResultView, ToolSearchMatch, ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { computeDiff } from "@stigmer/react-core";
import { useFileReviewRowFile } from "@stigmer/react-core/internal";
import { BoundedContent } from "../internal/BoundedContent.js";
import { SCROLL_REGION_FOCUS, scrollRegion } from "../internal/scroll-region.js";
import { STEP_INSET, STEP_INSET_FOOT } from "../internal/thread-card/index.js";
import { DiffViewer } from "../version-history/DiffViewer.js";
import { FileChangeDiff } from "./FileChangesView.js";
import { useFileReviewRowChange } from "@stigmer/react-core";
import { McpToolDetail } from "./McpToolDetail.js";
import { ToolArgsView } from "./ToolArgsView.js";
import { ResultView } from "./ResultView.js";
import { useToolPresentation } from "./tool-presenter.js";
import type { ToolCategory } from "@stigmer/react-core";
import { FilePathContext } from "./FilePathContext.js";
import { resolvePathAction } from "./file-path-resolver.js";
import { useSandboxNormalize } from "./SandboxContext.js";
import {
  describeApprovalPolicySource,
  isInformativePolicySource,
} from "./approval-provenance.js";

/** Props for {@link ToolCallDetail}. */
export interface ToolCallDetailProps {
  /** The tool use to render in detail (from the session's fold). */
  readonly toolUse: ToolUse;
  /**
   * Whether the owning row's header truncated the primary argument (the search
   * query / list path). A header-owned layout fact: when `true`, the search/list
   * body restates the full, wrapping value so a long query is reachable without
   * relying on the hover tooltip; when `false` (the default) the header already
   * shows the value in full, so the body does not repeat it. Only the
   * search/list branch consumes it.
   */
  readonly primaryArgTruncated?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders what a single tool call did, as an opened step shows it: in one
 * quiet box (the drawing's `.out`: the faint ground, a muted hairline, mono
 * 12/16 in the muted foreground), whatever the call's kind.
 *
 * - **A read** shows the lines it read, the first few with "Show all" in
 *   place, and under the box the range it read ("Lines 14–17 of 88") and
 *   "Open the whole file" where the session can open the path
 *   (`FilePathContext.canOpenFilePath`).
 * - **A write** shows the file's first lines with "Lines 1–5 of 24" under
 *   them, then "Open the whole file" or "Show all"; a write over a file its
 *   turn captured shows that change as its diff instead.
 * - **An edit** shows its diff, each removed line beside the line that
 *   replaced it, unnumbered (its lines are counted from the fragment, not
 *   the file), under a header naming the file. A failed edit shows what it
 *   tried.
 * - **A search** shows one line per match, the file and line then the
 *   matched text; a search by name and a listing show their files.
 * - **A command** shows its output's last lines ("Last 5 of 214 lines ·
 *   Show all"); while it runs, its newest lines as they print.
 * - **A connected app's call** shows its fields, the answer as the last.
 *
 * Arguments render through the shared {@link ToolArgsView} (same component
 * used by {@link ApprovalCard}) where a kind has nothing better; results are
 * read from `@stigmer/client`'s `normalizeToolResult`.
 *
 * Importable on its own by platform builders composing custom tool UIs.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function ToolCall({ toolUse }: { toolUse: ToolUse }) {
 *   return <ToolCallDetail toolUse={toolUse} />;
 * }
 * ```
 */
export function ToolCallDetail({
  toolUse,
  primaryArgTruncated = false,
  className,
}: ToolCallDetailProps) {
  const { category, result, primaryArg } = useToolPresentation(toolUse);

  // The captured net change a write row renders as its inline diff (see the
  // write branch below): its turn's capture of the row's file. Resolved here
  // unconditionally (Rules of Hooks); null for every other category's rows
  // and for every honest-degradation case.
  const capturedChange = useFileReviewRowChange(
    toolUse.runId,
    category === "write" ? primaryArg : null,
  );
  // Whether the turn made the file a write wrote (its review's `added`):
  // a new file shows its lines, not a diff of nothing.
  const created = useFileReviewRowFile(toolUse.runId, category === "write" ? primaryArg : null)?.change === "added";

  return (
    <div className={cn("stg:space-y-2 stg:text-xs", className)}>
      <CategoryDetail
        toolUse={toolUse}
        category={category}
        result={result}
        primaryArg={primaryArg}
        primaryArgTruncated={primaryArgTruncated}
        capturedChange={created ? null : capturedChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category composition
//
// Invariant: the owning row's line owns the METADATA (mark, words, file name,
// ± counts, the app, status, time); the body owns the CONTENT, in one box,
// plus at most a ProvenanceNote when the authorization provenance is
// genuinely informative. The body never restates the line.
// ---------------------------------------------------------------------------

function CategoryDetail({
  toolUse,
  category,
  result,
  primaryArg,
  primaryArgTruncated,
  capturedChange,
}: {
  toolUse: ToolUse;
  category: ToolCategory;
  result: ToolResultView;
  primaryArg: string | null;
  primaryArgTruncated: boolean;
  capturedChange: CapturedFileChange | null;
}) {
  const args = <ArgsSection toolUse={toolUse} />;

  switch (category) {
    case "think":
      return <ThinkToolDetail toolUse={toolUse} />;

    case "mcp":
      return <McpToolDetail toolUse={toolUse} />;

    case "search":
    case "list":
      // The line names the query and counts the matches; the body is the
      // matches, and the whole query only when the line had to cut it.
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {primaryArgTruncated && primaryArg && <SearchQueryBlock category={category} value={primaryArg} />}
          <MatchesBox view={result} folder={searchFolderOf(toolUse)} />
        </>
      );

    case "edit": {
      // A failed edit opens to what it tried; a done one to what it changed.
      const view = result.type === "diff" ? result : editAttemptOf(toolUse);
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {/* A diff or an error has no line limit of its own: the shared
              pixel clamp bounds it, with one reveal in place. */}
          <BoundedContent cursorTarget="tool-detail-expand">
            {view !== undefined ? <StepDiff path={view.path} oldText={view.oldText} newText={view.newText} /> : <ErrorBox view={result} />}
          </BoundedContent>
        </>
      );
    }

    case "write":
      // A write over a file its turn captured shows what it changed; a new
      // file, or one with no capture, shows its first lines.
      if (capturedChange) {
        return (
          <>
            <ProvenanceNote toolUse={toolUse} />
            <CapturedRowDiff change={capturedChange} />
          </>
        );
      }
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {result.type === "file" && result.content !== "" ? (
            <FileExcerpt path={primaryArg} content={result.content} footFor={writeFoot} />
          ) : (
            <BoundedContent cursorTarget="tool-detail-expand">
              <ErrorBox view={result} />
            </BoundedContent>
          )}
        </>
      );

    case "read":
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {result.type === "file" && result.content !== "" ? (
            <FileExcerpt
              path={primaryArg}
              content={result.content}
              footFor={() => readFoot(result.type === "file" ? result : undefined)}
            />
          ) : result.type === "error" ? (
            <ErrorBox view={result} />
          ) : (
            args
          )}
        </>
      );

    case "delete":
      // The line names the file; a delete's body is its answer, if any.
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {result.type !== "empty" && <ErrorBox view={result} />}
        </>
      );

    case "shell": {
      // The line names the command; the body is what it printed. While it
      // runs, in the foreground or the background, its newest lines as they
      // arrive (the fold's `liveOutput`, or the background command's own);
      // once it returned, its last lines.
      if (isBackgroundRunning(toolUse) && result.type === "terminal") {
        return (
          <>
            <ProvenanceNote toolUse={toolUse} />
            <CommandOutput stdout={result.stdout} stderr={result.stderr} live />
          </>
        );
      }
      if (toolUse.state === "running" && toolUse.liveOutput !== "") {
        return (
          <>
            <ProvenanceNote toolUse={toolUse} />
            <CommandOutput stdout={toolUse.liveOutput} stderr="" live />
          </>
        );
      }
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {result.type === "terminal" ? (
            <CommandOutput stdout={result.stdout} stderr={result.stderr} live={false} />
          ) : (
            <>
              {result.type === "error" && args}
              <ErrorBox view={result} />
            </>
          )}
        </>
      );
    }

    default:
      // fetch, web-search, unknown: input + effect.
      return (
        <>
          <ProvenanceNote toolUse={toolUse} />
          {args}
          <ResultView view={result} />
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// The box's contents
// ---------------------------------------------------------------------------

/** How many lines a file's or a command's box shows before "Show all". */
const EXCERPT_LINES = 5;

/** The lines of `text`, a final newline ending the last line rather than starting another. */
function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A link-styled act under a box ("Show all", "Open the whole file"). */
function FootAct({ children, onClick }: { readonly children: ReactNode; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="stg:cursor-pointer stg:text-foreground stg:underline stg:decoration-border stg:underline-offset-2 stg:hover:decoration-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** The foot's parts, joined by a quiet dot. */
function Foot({ parts }: { readonly parts: readonly ReactNode[] }) {
  if (parts.length === 0) return null;
  return (
    <p className={STEP_INSET_FOOT}>
      {parts.flatMap((part, at) => (at === 0 ? [<span key={at}>{part}</span>] : [" · ", <span key={at}>{part}</span>]))}
    </p>
  );
}

/** What the foot under a file's box says, given how many lines show of how many. */
type FootWords = (shown: number, total: number) => string | null;

/** A write's foot: "Lines 1–5 of 24" while the box shows part of it. */
function writeFoot(shown: number, total: number): string | null {
  return shown < total ? lineRangeWords({ start: 1, end: shown, total }) : null;
}

/** A read's foot: the lines it read ("Lines 14–17 of 88") when its answer says, or that it is part of the file when the engine cut it. */
function readFoot(view: Extract<ToolResultView, { type: "file" }> | undefined): string | null {
  if (view === undefined) return null;
  if (view.range !== undefined) return lineRangeWords(view.range);
  return view.truncated ? "Part of the file" : null;
}

/**
 * A file's lines in the box: the first few, then under the box what they
 * are, "Open the whole file" where the session can open the path, and
 * otherwise "Show all" in place.
 */
function FileExcerpt({ path, content, footFor }: { readonly path: string | null; readonly content: string; readonly footFor: FootWords }) {
  const [all, setAll] = useState(false);
  const { canOpenFilePath, onFilePathClick, resources } = useContext(FilePathContext);
  const lines = useMemo(() => linesOf(content), [content]);
  const clipped = !all && lines.length > EXCERPT_LINES;
  const shown = clipped ? lines.slice(0, EXCERPT_LINES) : lines;
  const opens = path !== null && path !== "" && canOpenFilePath?.(path) === true && onFilePathClick !== undefined;
  const lead = footFor(shown.length, lines.length);
  const parts: ReactNode[] = [];
  if (lead !== null) parts.push(lead);
  if (opens) {
    parts.push(<FootAct onClick={() => onFilePathClick(path, resolvePathAction(path, resources))}>Open the whole file</FootAct>);
  } else if (clipped) {
    parts.push(<FootAct onClick={() => setAll(true)}>Show all</FootAct>);
  }
  return (
    <div>
      <pre {...scrollRegion("File content")} className={cn(STEP_INSET, SCROLL_REGION_FOCUS)}>
        {shown.join("\n")}
      </pre>
      <Foot parts={parts} />
    </div>
  );
}

/**
 * A command's output in the box, its blank edges trimmed. While it runs, its
 * newest lines as they print; once it returned, its last few, with "Last 5
 * of 214 lines · Show all" once it printed more.
 */
function CommandOutput({ stdout, stderr, live }: { readonly stdout: string; readonly stderr: string; readonly live: boolean }) {
  const normalize = useSandboxNormalize();
  const [all, setAll] = useState(false);
  const text = normalize([stdout, stderr].filter((part) => part.trim() !== "").join("\n").replace(/^\s*\n/, "").trimEnd());
  if (text === "") return null;
  const lines = text.split("\n");
  const clipped = !all && lines.length > EXCERPT_LINES;
  const shown = clipped ? lines.slice(-EXCERPT_LINES) : lines;
  return (
    <div data-cursor-target="terminal-session">
      {/* It scrolls sideways, so it is a named region a keyboard reaches (stigmer#2899). */}
      <pre {...(live ? { "data-cursor-target": "terminal-live-output" } : {})} {...scrollRegion("Command output")} className={cn(STEP_INSET, SCROLL_REGION_FOCUS)}>
        {shown.join("\n")}
      </pre>
      {!live && clipped && (
        <Foot parts={[`Last ${EXCERPT_LINES} of ${lines.length} lines`, <FootAct onClick={() => setAll(true)}>Show all</FootAct>]} />
      )}
    </div>
  );
}

/** The folder a search or a listing looked in, from its input; "" when it names none. */
function searchFolderOf(toolUse: ToolUse): string {
  const path = toolUse.input["path"];
  if (typeof path !== "string") return "";
  // Trimmed by a loop: the path is the model's, and a pattern like /\/+$/
  // backtracks quadratically on a long run of separators.
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

/** A match's file, named from the folder searched ("invoice.ts" for src/billing/invoice.ts searched in src/billing). */
function relativeTo(file: string, folder: string): string {
  if (folder !== "" && file.startsWith(`${folder}/`)) return file.slice(folder.length + 1);
  const bare = folder.replace(/^\.?\//, "");
  if (bare !== "" && file.startsWith(`${bare}/`)) return file.slice(bare.length + 1);
  return file;
}

/**
 * A search's or a listing's findings in the box: one line per match, the
 * file and line, then the matched text in a second column; files alone for a
 * search by name or a listing. Nothing found says so.
 */
function MatchesBox({ view, folder }: { readonly view: ToolResultView; readonly folder: string }) {
  if (view.type === "list") {
    if (view.count === 0) return <p className="stg:text-xs stg:text-muted-foreground">Empty</p>;
    return (
      <pre {...scrollRegion("Files")} className={cn(STEP_INSET, SCROLL_REGION_FOCUS)}>
        {view.entries.join("\n")}
      </pre>
    );
  }
  if (view.type !== "search") return <ErrorBox view={view} />;
  if (view.count === 0 && view.matches.length === 0) {
    return <p className="stg:text-xs stg:text-muted-foreground">{view.kind === "files" ? "No files found" : "No matches"}</p>;
  }
  const more = view.truncated ? <p className={STEP_INSET_FOOT}>{`Showing the first ${view.matches.length} of ${view.count}`}</p> : null;
  if (view.kind === "files") {
    return (
      <div>
        <pre {...scrollRegion("Files")} className={cn(STEP_INSET, SCROLL_REGION_FOCUS)}>
          {view.matches.map((match) => relativeTo(match.file ?? match.text, folder)).join("\n")}
        </pre>
        {more}
      </div>
    );
  }
  return (
    <div>
      <div {...scrollRegion("Matches")} className={cn(STEP_INSET, SCROLL_REGION_FOCUS, "stg:grid stg:grid-cols-[auto_minmax(0,1fr)] stg:gap-x-4")}>
        {view.matches.map((match, at) => (
          <MatchLine key={at} match={match} folder={folder} />
        ))}
      </div>
      {more}
    </div>
  );
}

/** One match: where it is ("invoice.ts:41", or the line alone), then its text. */
function MatchLine({ match, folder }: { readonly match: ToolSearchMatch; readonly folder: string }) {
  const where = [match.file !== undefined ? relativeTo(match.file, folder) : "", match.line !== undefined ? String(match.line) : ""].filter((part) => part !== "").join(":");
  return (
    <>
      <span className="stg:select-none">{where}</span>
      <span className="stg:min-w-0">{match.text}</span>
    </>
  );
}

/**
 * An edit's diff, as the drawing's `.diff`: a header line naming the file on
 * the faint ground, then each removed line beside its replacement on the
 * card, unnumbered (an edit's lines are counted from its fragment, not the
 * file, and the run records no line in the file).
 */
function StepDiff({ path, oldText, newText }: { readonly path: string; readonly oldText: string | undefined; readonly newText: string | undefined }) {
  const hunks = useMemo(() => (oldText !== undefined && newText !== undefined ? computeDiff(oldText, newText) : []), [oldText, newText]);
  if (hunks.length === 0) return null;
  return (
    <div data-cursor-target="file-diff" className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border-muted stg:bg-card">
      {path !== "" && <div className="stg:truncate stg:bg-muted-faint stg:px-3 stg:py-0.5 stg:font-mono stg:text-xs stg:text-muted-foreground">{path}</div>}
      <DiffViewer hunks={hunks} lineNumbers={false} paired className="stg:rounded-none stg:border-0" />
    </div>
  );
}

/** An answer with no better view (an error, a delete's words, plain text), in the box. */
function ErrorBox({ view }: { readonly view: ToolResultView }) {
  const text = view.type === "error" ? view.message : view.type === "text" ? view.text : "";
  if (text.trim() === "") return view.type === "error" || view.type === "text" || view.type === "empty" ? null : <ResultView view={view} />;
  return <pre className={cn(STEP_INSET, "stg:whitespace-pre-wrap stg:break-words")}>{text.trim()}</pre>;
}

// The full, wrapping query (search) or path (list), shown in the body only when
// the owning row's header truncated it — so a long value is reachable without
// hovering, without restating a short value the header already shows in full.
function SearchQueryBlock({
  category,
  value,
}: {
  category: ToolCategory;
  value: string;
}) {
  const label = category === "list" ? "Path" : "Query";
  return (
    <div className="stg:space-y-1">
      <span className="stg:font-medium stg:text-muted-foreground">{label}</span>
      <code className="stg:block stg:whitespace-pre-wrap stg:break-words stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-foreground">
        {value}
      </code>
    </div>
  );
}

function ArgsSection({ toolUse }: { toolUse: ToolUse }) {
  return (
    <ToolArgsView
      toolName={toolUse.name}
      args={toolUse.input}
      mcpServerSlug={toolUse.mcpServerName}
    />
  );
}

function ThinkToolDetail({ toolUse }: { toolUse: ToolUse }) {
  const input = toolUse.input["thought"];
  const thought = (typeof input === "string" ? input : "") || (toolUse.result?.text ?? "");

  if (!thought) return null;

  return <p className={cn(STEP_INSET, "stg:whitespace-pre-wrap stg:font-sans stg:italic")}>{thought}</p>;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

// A write row's inline diff: the captured change projected onto the
// display FileChange and rendered through the same bounded FileChangeDiff the
// review card's body uses — offloaded-body fetch, binary notices, and
// truncation states included. The file name and the `+N −M` stats are
// suppressed: the owning row's line names the file and counts the lines.
function CapturedRowDiff({ change }: { change: CapturedFileChange }) {
  const adapted = useMemo(() => toDisplayFileChange(change), [change]);
  return <FileChangeDiff change={adapted} bounded showFileName={false} showStats={false} />;
}

// The detail body's only metadata. Duration and the MCP slug live in the owning
// row header (ToolCallItem / ApprovalCardHeader), so the body never restates
// them; it surfaces the rule that asked about the call (its ask's policy
// source) ONLY when it is genuinely informative — a hook, a server-marked
// destructive tighten, a lease or bypass. The everyday "this category just
// needs approval" default and a call no rule asked about render nothing,
// mirroring the approval gate's smart-suppress (isInformativePolicySource).
function ProvenanceNote({ toolUse }: { toolUse: ToolUse }) {
  const source = toolUse.ask?.policySource ?? "";
  if (!isInformativePolicySource(source)) return null;
  const provenance = describeApprovalPolicySource(source, toolUse.ask?.policyHook ?? "");
  if (!provenance) return null;

  return (
    <p className="stg:text-2xs stg:italic stg:text-muted-foreground">
      {provenance}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable duration string from two ISO 8601 timestamps, or
 * `null` when either timestamp is empty or invalid.
 */
export function formatDuration(
  startedAt: string,
  completedAt: string,
): string | null {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const ms = end - start;
  if (ms < 0) return null;

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * A call's duration for its header chip, in whole seconds in the one format
 * every surface uses (`formatElapsed`: "14s", "1m 05s"); `null` below one
 * second. A duration chip earns its place only when it carries information —
 * a `4ms` chip on a directory listing draws the eye to the least interesting
 * row in the thread (stigmer#274), so sub-second work renders no chip at all.
 * {@link formatDuration} stays exact — it is public API with consumers that
 * want the precise value.
 */
export function formatHeaderDuration(
  startedAt: string,
  completedAt: string,
): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 1000) return null;
  // Whole seconds, in the one duration format every surface uses.
  return formatElapsed(ms);
}
