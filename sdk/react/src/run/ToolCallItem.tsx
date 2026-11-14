"use client";

import { memo } from "react";
import { formatElapsed, isBackgroundRunning, type ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { useIsTextTruncated } from "../internal/useIsTextTruncated.js";
import {
  ThreadCardShell,
  ThreadCardHeader,
  ThreadCardHeaderControl,
  ThreadCardBody,
  type ThreadCardVariant,
  SpinnerIcon,
  ClockIcon,
  XCircleIcon,
  SlashCircleIcon,
} from "../internal/thread-card/index.js";
import { ToolCallDetail, formatHeaderDuration } from "./ToolCallDetail.js";
import { useElapsedSince } from "../internal/useElapsedSince.js";
import { hasResultBody, resultCounts, type ResultCounts } from "./ResultView.js";
import { SubagentSection } from "./SubagentSection.js";
import { ApprovalCardBody, ApprovalCardHeader } from "./ApprovalCard.js";
import { MemoryProposalCardBody } from "../memory/MemoryProposalCard.js";
import { useApproval, useWaitingWords } from "./ApprovalContext.js";
import { BackgroundCommandTrail, BackgroundStopError } from "./BackgroundCommandStatus.js";
import { useBackgroundStop } from "./BackgroundCommandContext.js";
import { useFileReviewRowState } from "@stigmer/react-core";
import { CHANGE_WORDS } from "../session/turn-change-words.js";
import { FilePathLink } from "./FilePathLink.js";
import { sizeWords } from "../internal/size-words.js";
import { fileKind } from "../session/TurnOutcome.js";
import { splitDisplayPath } from "./file-path-resolver.js";
import { subagentSubjectOf } from "@stigmer/react-core";
import { isFileCategory } from "@stigmer/react-core/internal";
import { type ToolCategory } from "@stigmer/react-core";
import { getToolPresenter, useToolPresentation } from "./tool-presenter.js";
import { StatusBadge } from "../status/StatusBadge.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import { Tag } from "../internal/surface/Tag.js";
import { HelperEndingBadge, HelperGlyph, helperTagWord } from "./helper-step.js";

/** Props for {@link ToolCallItem}. */
export interface ToolCallItemProps {
  /**
   * The tool use to render as a summary row (from the session's fold). A
   * tool use that started a subagent (`toolUse.thread`) renders its
   * {@link SubagentSection} as the detail panel instead of a
   * {@link ToolCallDetail}.
   */
  readonly toolUse: ToolUse;
  /**
   * Forces the detail panel open on first render regardless of the
   * auto-disclosure policy. Defaults to `false`.
   */
  readonly defaultExpanded?: boolean;
  /**
   * Whether the row renders as its own self-contained card (a thin rounded
   * border). Defaults to `true`. Set to `false` when the row is nested inside a
   * container that already provides the border — e.g. the folded
   * `ToolRunGroup` chip — where the row falls back to a divider-separated
   * row to avoid a card-in-a-card.
   */
  readonly bordered?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a single tool call as one step: a line in plain words, closed
 * until clicked, opening in place to what the step did.
 *
 * - **The line** says what the call did, in the tense it stands in, from
 *   `stepPhrase` (`@stigmer/client`): "Editing invoice.ts" while it runs,
 *   "Edited invoice.ts" once it returned, "Couldn't edit invoice.ts" when it
 *   failed. A command reads as the agent's own description when it wrote one,
 *   with the command beside it; a connected app's tool reads as its own name
 *   with the app beside it. A host's `registerToolPresenter` label wins
 *   over all of it. Beside the words: how much changed (`+2 −2`), the
 *   matches or items found, a non-zero exit, and the folder of the file.
 * - **Closed by default.** A settled step opens on a click to its body: the
 *   diff, the lines read or written, the matches, the command's output, the
 *   MCP call's fields and result, a subagent's own steps. A step with
 *   nothing to show has no chevron and opens to nothing, never to an empty
 *   box.
 * - **Open while it matters.** {@link useAutoDisclosure} opens a step while
 *   it runs (a command streams its output as it prints), while it waits for
 *   a person (its decision inline), and, for a command, once it failed; a
 *   manual click always wins thereafter.
 * - **Preview** (a memory proposal, or a kind a host asks to preview): the
 *   body is always in view under a plain line, because it is a decision
 *   surface.
 *
 * Inside a list of steps (`bordered={false}`) a step is a divider row; on
 * its own it is a card, or a quiet unboxed line for the metadata-only kinds
 * (read, list, search, think) unless it waits or failed. A pending gate
 * carries a restrained left accent.
 *
 * A call that started a helper (`toolUse.thread`) draws the helper's header:
 * its subject as the line, its agent's name as a tag beside it ("Helper"
 * when it has none), and a pill only once the helper failed or stopped; the
 * body is the helper's work ({@link SubagentSection}'s flat form).
 *
 * A call that started a command in the background (`toolUse.background`)
 * is the command's row: one line saying how the command stands ("Running in
 * the background · 12s", or how it ended), the running look (shimmer,
 * spinner, open) for as long as the command runs though the call itself
 * returned, its output in the body, and a quiet Stop while a stop handler is
 * wired ({@link BackgroundCommandContext}).
 *
 * Wrapped in `React.memo` — the session fold keeps an unchanged tool use's
 * reference, so a settled row skips re-renders while sibling tools stream.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function Step({ toolUse }: { toolUse: ToolUse }) {
 *   return <ToolCallItem toolUse={toolUse} />;
 * }
 * ```
 */
export const ToolCallItem = memo(function ToolCallItem({
  toolUse,
  defaultExpanded = false,
  bordered = true,
  className,
}: ToolCallItemProps) {
  useRenderTracer("ToolCallItem", { status: toolUse.state, id: toolUse.id });

  // A background command still running keeps the row live though its call
  // returned: the call and the command are two facts, and the row shows the
  // one still moving.
  const backgroundRunning = isBackgroundRunning(toolUse);
  const { kind, category, title, phrase, primaryArg, result, resultSummary, disclosure, chrome } = useToolPresentation(toolUse);
  // A command that exited non-zero failed though the engine did not mark it
  // an error: its line, its mark and its open default all say so.
  const failed = phrase.tense === "failed" && toolUse.state !== "denied";
  const status: ItemStatus = backgroundRunning ? "running" : failed ? "failed" : ITEM_STATUS[toolUse.state];
  const isRunning = status === "running";
  // The leading mark says the step's state when the state says something
  // (running, waiting, failed, interrupted) and the step's kind once it is
  // done: success is the silent default, since a green check on every
  // settled row teaches the eye to ignore status entirely (stigmer#274).
  const StatusIcon = STATUS_ICON[status];
  // Header chips only when the duration carries information (>= 1s); the
  // sub-second chips were noise pinned to the least interesting rows.
  const settledDuration = formatHeaderDuration(toolUse.processedAt, toolUse.result?.processedAt ?? "");
  const thread = toolUse.thread;
  const isSubagent = thread !== undefined;
  const CategoryIcon = CATEGORY_ICON[category];

  // The decision for this exact call when it waits for a person (parent or
  // nested subagent), or null. Drives the inline approval panel and forces
  // the row open.
  const approval = useApproval(toolUse);
  // A step waiting on a person this viewer is not: it says whom it waits on.
  const waitingWords = useWaitingWords();
  const waitsOnSomeoneElse = status === "waiting" && approval == null;

  // A failed command stays open: its output is the content the person needs
  // next.
  const tailFailed = !isSubagent && disclosure === "tail" && failed;

  // What the step opens to. A running command opens to what it printed so
  // far, once it has printed something (the row above already names the
  // command); a running call of another kind has nothing to show until it
  // returns.
  const liveOutput = (isRunning && category === "shell" && toolUse.liveOutput !== "") || backgroundRunning;
  const hasBody =
    isSubagent ||
    approval != null ||
    result.type === "memoryProposal" ||
    liveOutput ||
    (toolUse.result !== undefined && hasResultBody(result));
  // A command left running in the background keeps its output in view, as
  // a running one does; a Stop that failed opens it again if it was closed,
  // since the reason sits in its body.
  const stopFailed = useBackgroundStop(toolUse)?.error != null;
  const autoOpen = (isRunning && hasBody) || approval != null || tailFailed || stopFailed;
  const [expanded, handleToggle] = useAutoDisclosure(autoOpen, {
    initialOpen: defaultExpanded || autoOpen,
  });

  // Subagents title the row with their subject; every other row with its
  // step line (a host's label, else `stepPhrase`).
  const displayLabel = isSubagent ? subagentSubjectOf(toolUse) || thread.agentName || title : title;
  // A helper's row carries its agent's name as a tag beside the subject, and
  // its ending as a pill in place of the status mark.
  const helperTag = isSubagent ? helperTagWord(thread.agentName, displayLabel) : null;
  const helperEnded = isSubagent && (thread.state === "failed" || thread.state === "stopped");

  const approvalBadge = getApprovalBadge(toolUse);

  // A file edit says only what changed it since: Undone, or Couldn't undo
  // (its turn's file review, matched by the row's path). A kept or
  // undecided edit says nothing: it is in place, which is what an edit is.
  const reviewState = useFileReviewRowState(toolUse.runId, isFileEditCategory(category) ? primaryArg : null);

  // A file step names its file in its line; the name is the file's own
  // control (it opens the file, or copies its path), so the line reads
  // "Edited invoice.ts" with "invoice.ts" pressable. A host's label, or a
  // name the line had to cut short, keeps the plain words.
  const fileName = !isSubagent && primaryArg != null && isFileCategory(category) ? splitDisplayPath(primaryArg).base : "";
  const linkedFile = fileName !== "" && displayLabel.endsWith(` ${fileName}`);
  const verb = linkedFile ? displayLabel.slice(0, displayLabel.length - fileName.length - 1) : displayLabel;

  // Beside the words: the command a command ran, a connected app's or an
  // unknown tool's first argument, and a file's folder.
  // A file step that failed says why, in its tool's own words (the first
  // line of its answer), where a settled one says its folder.
  const failureReason = failed && isFileCategory(category) && toolUse.result?.isError === true ? reasonOf(toolUse.result.text) : "";
  // A File the turn wrote to its outputs folder says what it is and how big,
  // not the folder's path ("Markdown · 4.1 KB").
  const outputWords = !failed && category === "write" && primaryArg != null ? outputFileWords(primaryArg, toolUse) : "";
  const detail = isSubagent
    ? null
    : category === "shell" || category === "mcp" || category === "unknown" || category === "background-stop"
      ? primaryArg
      : failureReason !== ""
        ? failureReason
        : outputWords !== ""
          ? outputWords
          : phrase.folder !== ""
          ? phrase.folder
          : null;
  // A host's registered summary (`registerToolPresenter({ summary })`) is
  // its own words for the counts, shown in their place.
  const hostSummary = !isSubagent && getToolPresenter(kind)?.summary !== undefined ? resultSummary : null;
  const counts = isSubagent || toolUse.result === undefined || hostSummary !== null ? null : resultCounts(result, category === "write");
  const countsText = hostSummary ?? (counts === null ? null : countsWords(counts));

  const { ref: detailRef, isTruncated: detailTruncated } = useIsTextTruncated<HTMLSpanElement>(detail !== null);

  const gateAccent = approval != null ? (category === "delete" ? "destructive" : "warning") : null;
  // The chrome tier (the density axis, stigmer#274): inside a list of steps
  // every step is a divider row; on its own a metadata-only step is a quiet
  // line until it waits or fails.
  const variant: ThreadCardVariant = !bordered
    ? "row"
    : chrome === "quiet" && !isSubagent && approval == null && !failed
      ? "quiet"
      : "card";

  const trailingContent = (
    <>
      {approvalBadge && <StatusBadge phase={approvalBadge.phase} label={approvalBadge.label} />}

      {(reviewState === "discarded" || reviewState === "failed") && (
        <span className="stg:inline-flex stg:shrink-0" data-cursor-target="file-review-row-badge">
          {reviewState === "discarded" ? <Tag>{CHANGE_WORDS.undone}</Tag> : <StatusBadge phase="failed" label={CHANGE_WORDS.undoFailed} />}
        </span>
      )}

      {phrase.app !== "" && (
        <Tag>{phrase.app}</Tag>
      )}

      <BackgroundCommandTrail toolUse={toolUse} />

      {isSubagent && <HelperEndingBadge state={thread.state} />}

      {/* A background command's own line already says its time. */}
      {isRunning && !isSubagent && !backgroundRunning ? (
        <RunningTime startedAt={toolUse.processedAt} />
      ) : (
        settledDuration && <span className="stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground">{settledDuration}</span>
      )}
    </>
  );

  // The disclosed body: a pending gate decides inline, a subagent shows its
  // delegation, a settled remember call renders the memory-proposal consent
  // surface, otherwise the category detail.
  const body = isSubagent ? (
    <SubagentSection
      thread={thread}
      subject={subagentSubjectOf(toolUse)}
      startedAt={toolUse.processedAt}
      completedAt={toolUse.result?.processedAt}
      collapsible={false}
    />
  ) : approval ? (
    // The row above is this approval's header, so render only the body (its
    // sentence + actions). The enclosing card carries the accent. The body
    // reads the proposed write content from the tool's input, which the
    // ask's sanitized preview cannot carry for a file of any real size
    // (stigmer#1107).
    <ApprovalCardBody toolUse={approval.toolUse} onAnswer={approval.onAnswer} isSubmitting={approval.isSubmitting} error={approval.error} />
  ) : result.type === "memoryProposal" ? (
    // The remember tool's consent chip: verbatim fact + Confirm/Reject, with
    // the record's CURRENT lifecycle fetched so a reloaded thread never
    // shows stale action buttons. Borderless — this row's card owns the
    // chrome (the ApprovalCardBody posture).
    <MemoryProposalCardBody memoryId={result.memoryId} fact={result.fact} />
  ) : (
    <>
      <BackgroundStopError toolUse={toolUse} />
      {/* A search or listing whose line had to cut its pattern restates it whole. */}
      <ToolCallDetail
        toolUse={toolUse}
        primaryArgTruncated={(category === "search" || category === "list") && primaryArg != null && !displayLabel.includes(primaryArg)}
      />
    </>
  );

  const headerInner = (
    <>
      {StatusIcon && !helperEnded ? (
        <span className={cn("stg:shrink-0", STATUS_COLOR[status])} aria-hidden="true">
          <StatusIcon />
        </span>
      ) : (
        <span className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
          <CategoryIcon />
        </span>
      )}

      <span className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:overflow-hidden">
      <span className="stg:flex stg:min-w-0 stg:items-baseline stg:gap-2 stg:overflow-hidden">
        {/* While the call runs, the line carries the ambient-liveness sweep
            (stigmer#277) — the shimmer class owns `color`, so it replaces
            (never joins) the static color utility. */}
        <span
          className={cn(
            "stg:min-w-0 stg:shrink-0 stg:max-w-full stg:truncate",
            // A step at work, failed or waiting on someone is news: its words at medium weight.
            isRunning ? "stgm-shimmer-label stg:font-medium" : failed || status === "waiting" ? "stg:font-medium stg:text-foreground" : "stg:text-foreground",
          )}
        >
          {linkedFile && primaryArg ? (
            <>
              {verb}{" "}
              {/* Its own control, beside the row's toggle rather than inside it. */}
              <ThreadCardHeaderControl className="stg:inline-flex stg:min-w-0">
                <FilePathLink path={primaryArg} className="stg:min-w-0 stg:font-sans stg:text-sm" />
              </ThreadCardHeaderControl>
            </>
          ) : (
            displayLabel
          )}
        </span>
        {helperTag !== null && <Tag>{helperTag}</Tag>}
        {counts?.kind === "exit" && (
          <StatusBadge phase="failed" label={`exit ${counts.code}`} />
        )}
      </span>
      {/* The second line, 12/16: what came of the step and where, as the
          drawing sets it under the step's words. */}
      {(counts?.kind === "lines" || counts?.kind === "count" || hostSummary !== null || detail !== null || waitsOnSomeoneElse) && (
        <span className="stg:flex stg:min-w-0 stg:items-baseline stg:gap-1 stg:text-xs stg:text-muted-foreground">
          {counts?.kind === "lines" && (
            <span className="stg:shrink-0 stg:font-mono stg:tabular-nums">
              <span className="stg:text-status-ready">+{counts.added}</span>{" "}
              <span className="stg:text-status-failed">{"−"}{counts.removed}</span>
            </span>
          )}
          {counts?.kind === "count" && <span className="stg:shrink-0 stg:tabular-nums">{counts.text}</span>}
          {hostSummary !== null && <span className="stg:shrink-0 stg:tabular-nums">{hostSummary}</span>}
          {(counts?.kind === "lines" || counts?.kind === "count" || hostSummary !== null) && detail !== null && <span aria-hidden="true">·</span>}
          {detail !== null && (
            <span ref={detailRef} className={cn("stg:min-w-0 stg:truncate", category === "shell" && "stg:font-mono")}>
              {detail}
            </span>
          )}
          {waitsOnSomeoneElse && <span className="stg:shrink-0 stg:text-status-degraded">{waitingWords}</span>}
        </span>
      )}
      </span>

      {trailingContent}
    </>
  );

  // A call waiting for this viewer's answer is the approval itself while it
  // waits: the ask's own head (what the agent wants, and what it would
  // touch) over its decision, one object in the gate's accent, never a step
  // line beside a card. Once answered it is a step line again.
  if (approval != null) {
    return (
      <ThreadCardShell variant="card" accent={gateAccent} cursorTarget="tool-call-row" className={className}>
        <div role="alert" aria-label={`Approval required for ${toolUse.name}`}>
          <ApprovalCardHeader toolUse={approval.toolUse} bordered />
          <ThreadCardBody cursorTarget="tool-preview">{body}</ThreadCardBody>
        </div>
      </ThreadCardShell>
    );
  }

  // Preview: a plain line above an always-visible body (a decision surface,
  // or a kind a host asks to preview).
  if (!isSubagent && disclosure === "preview" && hasBody) {
    return (
      <ThreadCardShell variant={variant} accent={gateAccent} cursorTarget="tool-call-row" className={className}>
        <ThreadCardHeader>{headerInner}</ThreadCardHeader>
        <ThreadCardBody cursorTarget="tool-preview" rail={variant === "quiet"}>
          {body}
        </ThreadCardBody>
      </ThreadCardShell>
    );
  }

  // Nothing to open: the line is the whole step.
  if (!hasBody) {
    return (
      <ThreadCardShell variant={variant} accent={gateAccent} cursorTarget="tool-call-row" className={className}>
        <ThreadCardHeader>{headerInner}</ThreadCardHeader>
      </ThreadCardShell>
    );
  }

  // The toggle's name says what the row is, from the header's own words.
  const toggleGesture = {
    kind: "expand",
    expanded,
    onToggle: handleToggle,
    label: toggleLabel(displayLabel, detail, isSubagent ? helperTag : countsText),
    ...(detail !== null && detailTruncated ? { hint: detail } : {}),
  } as const;

  return (
    <ThreadCardShell variant={variant} accent={gateAccent} cursorTarget="tool-call-row" className={className}>
      <ThreadCardHeader gesture={toggleGesture}>{headerInner}</ThreadCardHeader>
      {expanded && (
        <ThreadCardBody cursorTarget="tool-preview" rail={variant === "quiet"}>
          {body}
        </ThreadCardBody>
      )}
    </ThreadCardShell>
  );
});

/** The workspace's outputs folder, as a path names it. */
const OUTPUTS_FOLDER = ".stigmer/outputs/";

/**
 * The part of `path` below the outputs folder (the folder at its start or
 * after a "/"), or undefined. Found by index, not a pattern: a path is a
 * tool's input, and a pattern over it could take quadratic time.
 */
function underOutputs(path: string): string | undefined {
  for (let at = path.indexOf(OUTPUTS_FOLDER); at !== -1; at = path.indexOf(OUTPUTS_FOLDER, at + 1)) {
    if (at === 0 || path[at - 1] === "/") {
      const rest = path.slice(at + OUTPUTS_FOLDER.length);
      return rest === "" ? undefined : rest;
    }
  }
  return undefined;
}

/** A File written to the outputs folder in words, its kind and size ("Markdown · 4.1 KB"); "" for any other path. */
function outputFileWords(path: string, toolUse: ToolUse): string {
  const saved = underOutputs(path);
  if (saved === undefined) return "";
  const content = toolUse.input["content"];
  const size = typeof content === "string" ? sizeWords(new TextEncoder().encode(content).length) : (/\b(\d+(?:\.\d+)?\s?[KMG]?B)\b/.exec(toolUse.result?.text ?? "")?.[1] ?? "");
  const kind = fileKind(saved, "");
  return size === "" ? kind : `${kind} · ${size}`;
}

/** A tool's answer as the reason it failed: its first line, without an "Error:" label, as a sentence. */
function reasonOf(text: string): string {
  const first = (text.split("\n").find((line) => line.trim() !== "") ?? "").trim().replace(/^error:\s*/i, "");
  return first === "" ? "" : first.charAt(0).toUpperCase() + first.slice(1);
}

/** A running step's time, counted live from its start; nothing under a second. */
function RunningTime({ startedAt }: { readonly startedAt: string }) {
  const elapsed = useElapsedSince(startedAt);
  if (elapsed === null || elapsed < 1000) return null;
  return <span className="stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground">{formatElapsed(elapsed)}</span>;
}

/** Counts as words, for the toggle's name: "+2 −2", "exit 1", "2 matches". */
function countsWords(counts: ResultCounts): string {
  switch (counts.kind) {
    case "lines":
      return `+${counts.added} −${counts.removed}`;
    case "exit":
      return `exit ${counts.code}`;
    case "count":
      return counts.text;
  }
}

/**
 * The name of a row's toggle: "Edited invoice.ts, +2 −2", "Searched for
 * round( in src/billing, 2 matches", "Ran a command npm test". Spoken in
 * place of the header's text, so it carries what the header says about the
 * call; status and duration stay readable beside it.
 */
function toggleLabel(title: string, detail: string | null, summary: string | null): string {
  const named = detail ? `${title} ${detail}` : title;
  return summary ? `${named}, ${summary}` : named;
}

// ---------------------------------------------------------------------------
// Approval badge
// ---------------------------------------------------------------------------

interface ApprovalBadgeInfo {
  readonly label: string;
  readonly phase: StatusPhase;
}

/**
 * How a person answered a call that asked: Approved (an allow, or a grant
 * given on this call) or Denied. A call that never asked, or still waits,
 * shows no badge.
 */
function getApprovalBadge(toolUse: ToolUse): ApprovalBadgeInfo | null {
  if (toolUse.ask === undefined) return null;
  if (toolUse.confirmation?.result === "deny") {
    return { label: "Denied", phase: "failed" };
  }
  if (toolUse.confirmation?.result === "allow" || toolUse.grant !== undefined) {
    return { label: "Approved", phase: "ready" };
  }
  return null;
}

/** Whether a category's row edits a file, the rows a file review badges. */
function isFileEditCategory(category: ToolCategory): boolean {
  return category === "write" || category === "edit" || category === "delete";
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

type ItemStatus = "running" | "waiting" | "failed" | "completed" | "interrupted";

/**
 * The row's status from the tool use's state. A denied call settles quietly
 * (its badge says Denied); a call its turn stopped before it returned is
 * interrupted (issue #207): not a spinner (nothing runs), not a failure (the
 * tool never errored).
 */
const ITEM_STATUS: Record<ToolUse["state"], ItemStatus> = {
  running: "running",
  waiting: "waiting",
  failed: "failed",
  completed: "completed",
  denied: "completed",
  stopped: "interrupted",
};

const STATUS_COLOR: Record<ItemStatus, string> = {
  running: "stg:text-foreground",
  waiting: "stg:text-status-degraded",
  failed: "stg:text-destructive",
  completed: "stg:text-status-ready",
  interrupted: "stg:text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Category-specific icons (inline SVG, SDK pattern)
// ---------------------------------------------------------------------------

export const CATEGORY_ICON: Record<ToolCategory, () => React.JSX.Element> = {
  shell: TerminalIcon,
  read: FileIcon,
  write: FilePenIcon,
  edit: FilePenIcon,
  delete: TrashIcon,
  search: SearchIcon,
  list: FolderIcon,
  fetch: GlobeIcon,
  "web-search": GlobeIcon,
  think: BrainIcon,
  "subagent": HelperGlyph,
  internal: WrenchIcon,
  mcp: McpPlugIcon,
  memory: BookmarkIcon,
  "background-stop": StopSquareIcon,
  skill: BookIcon,
  unknown: WrenchIcon,
};

function BookIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2.5a1 1 0 0 1 1-1h6.5v8H3a1 1 0 0 0-1 1z" />
      <path d="M2 10.5a1 1 0 0 1 1-1h6.5v1.5H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function StopSquareIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11L6 8.5L3 11V2.5C3 1.95 3.45 1.5 4 1.5H8C8.55 1.5 9 1.95 9 2.5V11Z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M1.5 6H10.5" />
      <path d="M6 1.5C7.5 3 7.5 9 6 10.5C4.5 9 4.5 3 6 1.5Z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1.5" width="10" height="9" rx="1.5" />
      <path d="M3 4.5L5 6.5L3 8.5" />
      <path d="M6.5 8.5H9" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
    </svg>
  );
}

function FilePenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
      <path d="M5 7L8 7" />
      <path d="M5 9L7 9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3H10" />
      <path d="M3 3V10C3 10.55 3.45 11 4 11H8C8.55 11 9 10.55 9 10V3" />
      <path d="M4.5 1H7.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="5.5" r="3.5" />
      <path d="M8 8L10.5 10.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3V9.5C1.5 10.05 1.95 10.5 2.5 10.5H9.5C10.05 10.5 10.5 10.05 10.5 9.5V4.5C10.5 3.95 10.05 3.5 9.5 3.5H6L5 2H2.5C1.95 2 1.5 2.45 1.5 3Z" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2C4.9 2 4 2.9 4 4C3.17 4 2.5 4.67 2.5 5.5C2.5 6.33 3 6.87 3 6.87C2.5 7.37 2.5 8.13 3 8.63C3.5 9.13 4.3 9.13 4.8 8.63L6 7.5" />
      <path d="M6 2C7.1 2 8 2.9 8 4C8.83 4 9.5 4.67 9.5 5.5C9.5 6.33 9 6.87 9 6.87C9.5 7.37 9.5 8.13 9 8.63C8.5 9.13 7.7 9.13 7.2 8.63L6 7.5" />
      <path d="M6 7.5V11" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 2C7.67 2 7 2.67 7 3.5C7 3.78 7.08 4.04 7.22 4.26L3.74 7.74C3.52 7.6 3.27 7.5 3 7.5C2.17 7.5 1.5 8.17 1.5 9C1.5 9.83 2.17 10.5 3 10.5C3.83 10.5 4.5 9.83 4.5 9C4.5 8.73 4.4 8.48 4.26 8.26L7.74 4.78C7.96 4.92 8.22 5 8.5 5C9.33 5 10 4.33 10 3.5C10 3.22 9.92 2.96 9.78 2.74L8.5 4L7.5 3L8.76 1.72C8.54 1.58 8.28 1.5 8 1.5" />
    </svg>
  );
}

function McpPlugIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5V4" />
      <path d="M8 1.5V4" />
      <path d="M2.5 4H9.5V6.5C9.5 8.43 7.93 10 6 10C4.07 10 2.5 8.43 2.5 6.5V4Z" />
      <path d="M6 10V11" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Status icons — the shared thread-card glyph set
// ---------------------------------------------------------------------------

// `completed` is deliberately iconless — success is the silent default, so
// the states that remain visible (spinner, clock, cross, slash) all carry
// real signal (stigmer#274).
const STATUS_ICON: Record<ItemStatus, (() => React.JSX.Element) | null> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: null,
  interrupted: SlashCircleIcon,
};
