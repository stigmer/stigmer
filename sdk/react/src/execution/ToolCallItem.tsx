"use client";

import { memo } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { useIsTextTruncated } from "../internal/useIsTextTruncated.js";
import {
  ThreadCardShell,
  ThreadCardHeader,
  ThreadCardBody,
  type ThreadCardVariant,
  SpinnerIcon,
  ClockIcon,
  XCircleIcon,
  DotIcon,
  SlashCircleIcon,
} from "../internal/thread-card/index.js";
import { TerminalTail } from "./TerminalSession.js";
import { ToolCallDetail, formatHeaderDuration } from "./ToolCallDetail.js";
import { SubAgentSection } from "./SubAgentSection.js";
import { ApprovalCardBody } from "./ApprovalCard.js";
import { useApproval } from "./ApprovalContext.js";
import { useFileReviewRowState } from "./FileReviewContext.js";
import type { FileReviewRowState } from "./file-review-status.js";
import { FilePathLink } from "./FilePathLink.js";
// ToolChrome is type-only here so the doc link below resolves; the strict
// tsdoc gate (tsdoc:check) guards it against removal.
import { isFileCategory, type ToolCategory, type ToolChrome } from "./tool-categories.js";
import { useToolPresentation } from "./tool-presenter.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";

/** Props for {@link ToolCallItem}. */
export interface ToolCallItemProps {
  /** The tool call to render as a summary row. */
  readonly toolCall: ToolCall;
  /**
   * When present, this tool call is a sub-agent delegation. The
   * detail panel renders a {@link SubAgentSection} instead of
   * a {@link ToolCallDetail}.
   */
  readonly subAgentExecution?: SubAgentExecution | null;
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
 * Renders a single tool call as a row in the tool call group.
 *
 * Four rendering modes, set by one rule — **does the body carry content the
 * one-line row cannot, and does it stay content once the call settles?**
 *
 * - **Non-expandable** (completed/skipped Read): a static `<div>` row with a
 *   clickable {@link FilePathLink}. The path IS the complete information.
 * - **Preview** (content-bearing: edit / write / fetch / web-search /
 *   unknown / mcp): a plain (non-button) header above an **always-visible**
 *   {@link ToolCallDetail} body — Cursor-style "previews aren't collapsible".
 *   There is no header chevron; each content block self-bounds with its own
 *   single in-place reveal (`RevealToggle`), so a long diff or output
 *   never floods the thread. The body is suppressed only for an `empty` result,
 *   which stays a clean one-line row.
 * - **Tail** (shell): live like preview — the full terminal session streams in
 *   view while the command runs or awaits its gate — but a *successful* settle
 *   collapses the row to a {@link TerminalTail} teaser (the `$ command` line
 *   plus a dimmed tail of the last output lines) behind the header chevron.
 *   A settled failure stays open: error output is content, not context. A
 *   result that isn't a terminal session (e.g. an offloaded `outputRef`)
 *   falls back to the preview layout — never hide evidence we cannot condense.
 * - **Summary / sub-agent** (read / list / search / delete / think, and
 *   sub-agent delegations): a chevron-gated `div[role=button]` header that
 *   discloses a body hidden by default — {@link ToolCallDetail}, a
 *   {@link SubAgentSection}, or, when gated, an inline {@link ApprovalCardBody}.
 *   {@link useAutoDisclosure} force-opens it while *running* or *awaiting
 *   approval*, then settles it closed; a manual click always wins thereafter.
 *
 * The two disclosure axes — the card-level chevron and a block's
 * content-overflow reveal — never govern the same body, which is what removes
 * the old "expand, then Show more" double control.
 *
 * Orthogonal to the layout modes is the **chrome tier** (the density axis,
 * stigmer#274): metadata-only categories (read / list / search / think)
 * render as quiet unboxed lines — no card frame — while content-bearing
 * categories keep their cards. A quiet row escalates to a card while gated
 * or failed; its disclosed body renders under a light left rail instead of a
 * border. See {@link ToolChrome}.
 *
 * Shows category-aware labels (e.g., "Shell", "Read", "Edit") with
 * the primary argument as a subtitle, a category-specific icon, and
 * an inline approval decision badge when applicable.
 *
 * Wrapped in `React.memo` — structural sharing (DD-009/010) preserves
 * the `ToolCall` reference when unchanged, so a settled row skips
 * re-renders while sibling tools stream.
 *
 * @example
 * ```tsx
 * <ToolCallItem toolCall={tc} />
 * <ToolCallItem toolCall={tc} subAgentExecution={sub} />
 * ```
 */
export const ToolCallItem = memo(function ToolCallItem({
  toolCall,
  subAgentExecution,
  defaultExpanded = false,
  bordered = true,
  className,
}: ToolCallItemProps) {
  useRenderTracer("ToolCallItem", { status: toolCall.status, id: toolCall.id });

  const status = mapToolCallStatus(toolCall);
  const isRunning = status === "running";
  // Success is the silent default: a completed row renders NO status icon —
  // a green check on every settled row teaches the eye to ignore status
  // entirely, so state is shown only when it says something (running, gated,
  // failed, interrupted). Failure shouts; success is quiet (stigmer#274).
  const StatusIcon = STATUS_ICON[status];
  // Header chips only when the duration carries information (>= 1s); the
  // sub-second chips were noise pinned to the least interesting rows.
  const duration = formatHeaderDuration(toolCall.startedAt, toolCall.completedAt);
  const isSubAgent = subAgentExecution != null;

  const { category, label, primaryArg, result, resultSummary, disclosure, chrome } =
    useToolPresentation(toolCall);
  const CategoryIcon = CATEGORY_ICON[category];

  // An unresolved approval gating this exact call (parent or nested sub-agent),
  // or null. Drives the inline approval panel and forces the row open.
  const approval = useApproval(toolCall.id);

  // Tail rows (shell): a settled failure keeps the row open — the error output
  // is the content the user needs next, so it must never settle into a dimmed
  // teaser. Detected on the result, not just the status: a command that
  // "completed" with a non-zero exit is a failure to the reader.
  const isTailCategory = !isSubAgent && disclosure === "tail";
  const tailFailed =
    isTailCategory &&
    (toolCall.status === ToolCallStatus.TOOL_CALL_FAILED ||
      result.type === "error" ||
      (result.type === "terminal" &&
        result.exitCode !== undefined &&
        result.exitCode !== 0));

  // The card-level disclosure for *summary* and *tail* rows (preview rows
  // ignore it — their body is always visible). Force-open only while the row
  // carries live or actionable content: while it runs, while it awaits
  // approval, or (tail rows) while it shows a failure; a manual toggle takes
  // over from there. Called unconditionally to honour the rules of hooks even
  // though preview rows do not read `expanded`.
  const autoOpen =
    toolCall.status === ToolCallStatus.TOOL_CALL_RUNNING ||
    approval != null ||
    tailFailed;
  const [expanded, handleToggle] = useAutoDisclosure(autoOpen, {
    initialOpen: defaultExpanded || autoOpen,
  });

  const displayLabel = isSubAgent
    ? subAgentExecution.subject || subAgentExecution.name || label
    : label;

  const approvalBadge = getApprovalBadge(toolCall);

  // A flowed file edit stamped with its change set id badges the set's live
  // review state (pending review / kept / discarded) right on the row — the
  // observational record stays in place while the decision surface is the
  // set's own bar. Null for unstamped rows and honest-degradation cases.
  const reviewState = useFileReviewRowState(toolCall.fileChangeSetId, primaryArg);
  const reviewBadge = reviewState ? REVIEW_BADGE[reviewState] : null;

  // Search/list show their query/path as the header subtitle (truncated). Track
  // whether it actually clips so the expanded detail can restate the full,
  // wrapping value only when needed — avoiding a redundant repeat of a short
  // value the header already shows in full. Gated to these two categories so
  // only the rows that consume the signal pay for the measurement.
  const measuresSubtitle = category === "search" || category === "list";
  const { ref: subtitleRef, isTruncated: primaryArgTruncated } =
    useIsTextTruncated<HTMLSpanElement>(measuresSubtitle);

  // Cursor-style chrome via the shared ThreadCardShell (T05): each tool call
  // is its own self-contained card — a thin rounded neutral border. A pending
  // gate carries a restrained left accent on the card itself (warning, or
  // destructive for a delete); that accent is the only "awaiting you" cue now
  // that the amber fill is gone. Nested inside a folded run chip the card
  // degrades to a divider-separated row (via `bordered={false}`) so we never
  // draw a card inside a card.
  const gateAccent =
    approval != null ? (category === "delete" ? "destructive" : "warning") : null;

  // The chrome tier (the density axis, stigmer#274): metadata-only rows
  // (read / list / search / think) render as quiet unboxed lines — no card
  // frame — so the conversation reads as prose with quiet evidence attached.
  // A row escalates to a card while it carries something a bare line cannot:
  // a pending gate (the decision surface, including its accent) or a failure
  // (error output is content). Running deliberately does NOT escalate — a
  // quiet row's in-flight state rides its label and status glyph, not a
  // frame. Nested rows (inside an expanded fold chip) stay divider rows:
  // their container owns the frame.
  const rowFailed =
    toolCall.status === ToolCallStatus.TOOL_CALL_FAILED ||
    result.type === "error";
  const variant: ThreadCardVariant = !bordered
    ? "row"
    : chrome === "quiet" && !isSubAgent && approval == null && !rowFailed
      ? "quiet"
      : "card";

  // Completed/skipped Read items are non-expandable — the clickable
  // path in the row is the complete information. Failed reads remain
  // expandable to show the error.
  const isNonExpandableRead =
    !isSubAgent &&
    category === "read" &&
    (toolCall.status === ToolCallStatus.TOOL_CALL_COMPLETED ||
      toolCall.status === ToolCallStatus.TOOL_CALL_SKIPPED);

  const trailingContent = (
    <>
      {approvalBadge && (
        <span
          className={cn(
            "stg:shrink-0 stg:rounded stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none",
            approvalBadge.colorClass,
          )}
        >
          {approvalBadge.label}
        </span>
      )}

      {reviewBadge && (
        <span
          className={cn(
            "stg:shrink-0 stg:rounded stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none",
            reviewBadge.colorClass,
          )}
          data-cursor-target="file-review-row-badge"
        >
          {reviewBadge.label}
        </span>
      )}

      {toolCall.mcpServerSlug && (
        <span className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:font-mono stg:text-muted-foreground">
          {toolCall.mcpServerSlug}
        </span>
      )}

      {StatusIcon && (
        <span
          className={cn("stg:shrink-0", STATUS_COLOR[status])}
          aria-hidden="true"
        >
          <StatusIcon />
        </span>
      )}

      {duration && (
        <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
          {duration}
        </span>
      )}
    </>
  );

  if (isNonExpandableRead) {
    return (
      <ThreadCardShell
        variant={variant}
        accent={gateAccent}
        cursorTarget="tool-call-row"
        className={className}
      >
        <ThreadCardHeader>
          <span className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
            <CategoryIcon />
          </span>

          <span className="stg:min-w-0 stg:flex-1 stg:flex stg:items-center stg:gap-1.5 stg:overflow-hidden">
            <span className="stg:shrink-0 stg:font-medium stg:text-foreground">
              {displayLabel}
            </span>
            {primaryArg && (
              <FilePathLink path={primaryArg} className="stg:min-w-0 stg:text-xs" />
            )}
          </span>

          {trailingContent}
        </ThreadCardHeader>
      </ThreadCardShell>
    );
  }

  // Shell shows neither a command subtitle nor an exit summary in the header —
  // both live in the terminal session body below, so the header stays minimal
  // (icon + label + status + duration).
  const displaySubtitle =
    isSubAgent || category === "shell" ? null : primaryArg;

  // For file tools the subtitle is a path: render it filename-first through
  // FilePathLink (full path on hover) rather than the raw, often-absolute string
  // that buried the file name behind a long prefix.
  const subtitleIsFilePath =
    !isSubAgent && primaryArg != null && isFileCategory(category);

  // A tail row condenses only a terminal session. While gated it renders like
  // preview — decision actions are never hidden behind a chevron — and any
  // other result shape (an offloaded outputRef, bare error text) falls back to
  // preview too: never hide evidence the tail cannot honestly condense.
  const tailSession =
    isTailCategory && approval == null && result.type === "terminal"
      ? result
      : null;

  // Preview categories (edit, write, fetch, web-search, unknown, mcp) render
  // their body ALWAYS — Cursor-style "previews aren't collapsible" — so no
  // header chevron competes with the body's own in-place reveal. Summary
  // categories and sub-agents keep the chevron: their body is genuinely hidden
  // by default, so the chevron has a real job. The two disclosure axes
  // (card-level chevron vs. content-overflow reveal) never govern one body.
  const isPreviewLayout =
    !isSubAgent &&
    (disclosure === "preview" || (isTailCategory && tailSession == null));

  // The disclosed body, shared by both layouts: a pending gate decides inline,
  // a sub-agent shows its delegation, otherwise the category detail.
  const body = isSubAgent ? (
    <SubAgentSection subAgentExecution={subAgentExecution} collapsible={false} />
  ) : approval ? (
    // The row above is this approval's header, so render only the body (preview
    // + actions). The enclosing card already carries the border + warning/
    // destructive accent for a pending gate, so the body renders borderless.
    <ApprovalCardBody
      pendingApproval={approval.pendingApproval}
      onSubmit={approval.onSubmit}
      isSubmitting={approval.isSubmitting}
      error={approval.error}
    />
  ) : (
    <ToolCallDetail
      toolCall={toolCall}
      primaryArgTruncated={primaryArgTruncated}
    />
  );

  // The header's metadata, identical in both layouts (the chevron is appended
  // only by the summary layout below).
  const headerInner = (
    <>
      <span className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
        <CategoryIcon />
      </span>

      <span className="stg:min-w-0 stg:flex-1 stg:flex stg:items-baseline stg:gap-1.5 stg:overflow-hidden">
        {/* While the call runs, the label carries the ambient-liveness sweep
            (stigmer#277) — the shimmer class owns `color`, so it replaces
            (never joins) the static color utility. */}
        <span
          className={cn(
            "stg:shrink-0 stg:font-medium",
            isRunning ? "stgm-shimmer-label" : "stg:text-foreground",
          )}
        >
          {displayLabel}
        </span>
        {subtitleIsFilePath && primaryArg ? (
          <FilePathLink
            path={primaryArg}
            className="stg:min-w-0 stg:text-xs stg:text-muted-foreground"
          />
        ) : (
          displaySubtitle && (
            // Not TruncatedText: the span must carry the external measurement
            // ref (useIsTextTruncated) that the expanded detail reads.
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    ref={measuresSubtitle ? subtitleRef : undefined}
                    className="stg:min-w-0 stg:truncate stg:text-muted-foreground stg:font-mono"
                  />
                }
              >
                {displaySubtitle}
              </TooltipTrigger>
              <TooltipContent side="top" className="stg:break-all">
                {displaySubtitle}
              </TooltipContent>
            </Tooltip>
          )
        )}
        {!isSubAgent && category !== "shell" && resultSummary && (
          <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
            {resultSummary}
          </span>
        )}
      </span>

      {trailingContent}
    </>
  );

  // Preview layout: a plain (non-button) header above an always-visible body.
  // The body renders only when it has something to show — a pending gate, or a
  // non-empty result — so a tool that produced nothing stays a clean one-line
  // row, never an empty padded box.
  if (isPreviewLayout) {
    const showBody = approval != null || result.type !== "empty";
    return (
      <ThreadCardShell
        variant={variant}
        accent={gateAccent}
        cursorTarget="tool-call-row"
        className={className}
      >
        <ThreadCardHeader>{headerInner}</ThreadCardHeader>
        {showBody && (
          <ThreadCardBody cursorTarget="tool-preview" rail={variant === "quiet"}>
            {body}
          </ThreadCardBody>
        )}
      </ThreadCardShell>
    );
  }

  // Tail layout: a chevron-gated header whose body is never fully hidden —
  // expanded it is the live/full terminal session, collapsed it is the dimmed
  // TerminalTail teaser. useAutoDisclosure keeps it open while the command
  // runs and settles a *successful* session closed (tailFailed holds a failed
  // one open); a manual toggle always wins.
  if (tailSession) {
    return (
      <ThreadCardShell
        variant={variant}
        accent={gateAccent}
        cursorTarget="tool-call-row"
        className={className}
      >
        <ThreadCardHeader
          gesture={{ kind: "expand", expanded, onToggle: handleToggle }}
        >
          {headerInner}
        </ThreadCardHeader>
        {expanded ? (
          <ThreadCardBody cursorTarget="tool-preview">{body}</ThreadCardBody>
        ) : (
          <ThreadCardBody>
            <TerminalTail
              command={tailSession.command}
              stdout={tailSession.stdout}
              stderr={tailSession.stderr}
              exitCode={tailSession.exitCode}
            />
          </ThreadCardBody>
        )}
      </ThreadCardShell>
    );
  }

  // Summary / sub-agent layout: a chevron-gated header disclosing a body hidden
  // by default. The shell's `expand` gesture renders the div[role=button]
  // header with Enter/Space keyboard parity and the chevron.
  return (
    <ThreadCardShell
      variant={variant}
      accent={gateAccent}
      cursorTarget="tool-call-row"
      className={className}
    >
      <ThreadCardHeader gesture={{ kind: "expand", expanded, onToggle: handleToggle }}>
        {headerInner}
      </ThreadCardHeader>

      {expanded && (
        <ThreadCardBody rail={variant === "quiet"}>{body}</ThreadCardBody>
      )}
    </ThreadCardShell>
  );
});

// ---------------------------------------------------------------------------
// Approval badge
// ---------------------------------------------------------------------------

interface ApprovalBadgeInfo {
  readonly label: string;
  readonly colorClass: string;
}

function getApprovalBadge(toolCall: ToolCall): ApprovalBadgeInfo | null {
  if (!toolCall.requiresApproval) return null;
  switch (toolCall.approvalAction) {
    case ApprovalAction.APPROVE:
      return { label: "Approved", colorClass: "stg:bg-success/15 stg:text-success" };
    case ApprovalAction.SKIP:
      return { label: "Skipped", colorClass: "stg:bg-muted stg:text-muted-foreground" };
    case ApprovalAction.REJECT:
      return { label: "Rejected", colorClass: "stg:bg-destructive/15 stg:text-destructive" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// File-review badge — a stamped edit row's live review state
// ---------------------------------------------------------------------------

/**
 * The badge pill for each {@link FileReviewRowState}, in the approval badge's
 * visual vocabulary. "Kept"/"Discarded" match the decision surface's verdict
 * copy (see FileReviewCard's VerdictBadge) so the row and the bar always speak
 * the same language.
 */
const REVIEW_BADGE: Record<FileReviewRowState, ApprovalBadgeInfo> = {
  pending: { label: "Pending review", colorClass: "stg:bg-warning/15 stg:text-warning" },
  kept: { label: "Kept", colorClass: "stg:bg-success/15 stg:text-success" },
  discarded: { label: "Discarded", colorClass: "stg:bg-destructive/15 stg:text-destructive" },
  failed: { label: "Review failed", colorClass: "stg:bg-destructive/15 stg:text-destructive" },
};

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

type ItemStatus = "running" | "waiting" | "failed" | "completed" | "pending" | "interrupted";

function mapToolCallStatus(toolCall: ToolCall): ItemStatus {
  switch (toolCall.status) {
    case ToolCallStatus.TOOL_CALL_RUNNING:
      return "running";
    case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
      if (
        toolCall.approvalAction === ApprovalAction.APPROVE ||
        toolCall.approvalAction === ApprovalAction.SKIP ||
        toolCall.approvalAction === ApprovalAction.REJECT
      ) {
        return "completed";
      }
      return "waiting";
    case ToolCallStatus.TOOL_CALL_FAILED:
      return "failed";
    case ToolCallStatus.TOOL_CALL_COMPLETED:
    case ToolCallStatus.TOOL_CALL_SKIPPED:
      return "completed";
    // Platform-settled when the execution terminalized mid-call (issue #207).
    // A settled, neutral state: not a spinner (nothing is running), not a
    // failure (the tool never errored), not a grey pending dot (it will never
    // start).
    case ToolCallStatus.TOOL_CALL_INTERRUPTED:
      return "interrupted";
    default:
      return "pending";
  }
}

const STATUS_COLOR: Record<ItemStatus, string> = {
  running: "stg:text-foreground",
  waiting: "stg:text-warning",
  failed: "stg:text-destructive",
  completed: "stg:text-success",
  pending: "stg:text-muted-foreground",
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
  "sub-agent": BotIcon,
  internal: WrenchIcon,
  mcp: McpPlugIcon,
  unknown: WrenchIcon,
};

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

function BotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="8" height="6" rx="1.5" />
      <circle cx="4.5" cy="7" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="7" r="0.75" fill="currentColor" stroke="none" />
      <path d="M6 1V4" />
      <circle cx="6" cy="1" r="0.75" />
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
// Status icons — the shared thread-card glyph set (T05)
// ---------------------------------------------------------------------------

// `completed` is deliberately iconless — success is the silent default, so
// the states that remain visible (spinner, clock, cross, slash) all carry
// real signal (stigmer#274).
const STATUS_ICON: Record<ItemStatus, (() => React.JSX.Element) | null> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: null,
  pending: DotIcon,
  interrupted: SlashCircleIcon,
};
