"use client";

import { memo } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev";
import { useAutoDisclosure } from "../internal/useAutoDisclosure";
import { useIsTextTruncated } from "../internal/useIsTextTruncated";
import { ToolCallDetail, formatDuration } from "./ToolCallDetail";
import { SubAgentSection } from "./SubAgentSection";
import { ApprovalCardBody } from "./ApprovalCard";
import { useApproval } from "./ApprovalContext";
import { useFileReviewRowState } from "./FileReviewContext";
import type { FileReviewRowState } from "./file-review-status";
import { FilePathLink } from "./FilePathLink";
import { isFileCategory, type ToolCategory } from "./tool-categories";
import { useToolPresentation } from "./tool-presenter";
import { useThreadSelection } from "./useThreadSelection";

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
   * {@link ToolRunGroup} chip — where the row falls back to a divider-separated
   * row to avoid a card-in-a-card.
   */
  readonly bordered?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a single tool call as a row in the tool call group.
 *
 * Three rendering modes, set by one rule — **does the body carry content the
 * one-line row cannot?**
 *
 * - **Non-expandable** (completed/skipped Read): a static `<div>` row with a
 *   clickable {@link FilePathLink}. The path IS the complete information.
 * - **Preview** (content-bearing: shell / edit / write / fetch / web-search /
 *   unknown / mcp): a plain (non-button) header above an **always-visible**
 *   {@link ToolCallDetail} body — Cursor-style "previews aren't collapsible".
 *   There is no header chevron; each content block self-bounds with its own
 *   single in-place reveal ({@link RevealToggle}), so a long diff or output
 *   never floods the thread. The body is suppressed only for an `empty` result
 *   (e.g. a no-output shell), which stays a clean one-line row.
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
  const StatusIcon = STATUS_ICON[status];
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const isSubAgent = subAgentExecution != null;

  const { category, label, primaryArg, result, resultSummary, disclosure } =
    useToolPresentation(toolCall);
  const CategoryIcon = CATEGORY_ICON[category];

  // An unresolved approval gating this exact call (parent or nested sub-agent),
  // or null. Drives the inline approval panel and forces the row open.
  const approval = useApproval(toolCall.id);

  // The card-level disclosure for *summary* rows (preview rows ignore it — their
  // body is always visible). Force-open only while the row carries live or
  // actionable content: while it runs, or while it awaits approval; a manual
  // toggle takes over from there. Called unconditionally to honour the rules of
  // hooks even though preview rows do not read `expanded`.
  const autoOpen =
    toolCall.status === ToolCallStatus.TOOL_CALL_RUNNING || approval != null;
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

  const selection = useThreadSelection("tool-call", toolCall.id);

  // Search/list show their query/path as the header subtitle (truncated). Track
  // whether it actually clips so the expanded detail can restate the full,
  // wrapping value only when needed — avoiding a redundant repeat of a short
  // value the header already shows in full. Gated to these two categories so
  // only the rows that consume the signal pay for the measurement.
  const measuresSubtitle = category === "search" || category === "list";
  const { ref: subtitleRef, isTruncated: primaryArgTruncated } =
    useIsTextTruncated<HTMLSpanElement>(measuresSubtitle);

  // Cursor-style chrome: each tool call is its own self-contained card — a thin
  // rounded neutral border. A pending gate carries a restrained left accent on
  // the card itself (warning, or destructive for a delete); that accent is the
  // only "awaiting you" cue now that the amber fill is gone. Nested inside a
  // folded run chip the card degrades to a divider-separated row (via
  // `bordered={false}`) so we never draw a card inside a card.
  const cardClass = bordered
    ? cn(
        // border-prominent (not border): a transparent card needs a line the eye
        // actually catches — the default border token is white at 14% opacity,
        // which vanishes on the dark thread surface.
        "rounded-lg border border-border-prominent overflow-hidden",
        approval != null &&
          (category === "delete"
            ? "border-l-2 border-l-destructive"
            : "border-l-2 border-l-warning"),
        selection?.isSelected && "ring-1 ring-primary/40",
      )
    : cn(
        "border-b border-border-muted last:border-b-0",
        selection?.isSelected && "ring-1 ring-primary/40 rounded-sm",
      );

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
            "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
            approvalBadge.colorClass,
          )}
        >
          {approvalBadge.label}
        </span>
      )}

      {reviewBadge && (
        <span
          className={cn(
            "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
            reviewBadge.colorClass,
          )}
          data-cursor-target="file-review-row-badge"
        >
          {reviewBadge.label}
        </span>
      )}

      {toolCall.mcpServerSlug && (
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-muted-foreground">
          {toolCall.mcpServerSlug}
        </span>
      )}

      <span
        className={cn("shrink-0", STATUS_COLOR[status])}
        aria-hidden="true"
      >
        <StatusIcon />
      </span>

      {duration && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {duration}
        </span>
      )}

      {selection && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            selection.select();
          }}
          className={cn(
            "shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
            selection.isSelected && "text-primary",
          )}
          aria-label="Inspect tool call"
          aria-pressed={selection.isSelected}
        >
          <InspectIcon />
        </button>
      )}
    </>
  );

  if (isNonExpandableRead) {
    return (
      <div
        data-cursor-target="tool-call-row"
        className={cn(cardClass, className)}
      >
        <div
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs"
        >
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            <CategoryIcon />
          </span>

          <span className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
            <span className="shrink-0 font-medium text-foreground">
              {displayLabel}
            </span>
            {primaryArg && (
              <FilePathLink path={primaryArg} className="min-w-0 text-xs" />
            )}
          </span>

          {trailingContent}
        </div>
      </div>
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

  // Preview categories (shell, edit, write, fetch, web-search, unknown, mcp)
  // render their body ALWAYS — Cursor-style "previews aren't collapsible" — so
  // no header chevron competes with the body's own in-place reveal. Summary
  // categories and sub-agents keep the chevron: their body is genuinely hidden
  // by default, so the chevron has a real job. The two disclosure axes
  // (card-level chevron vs. content-overflow reveal) never govern one body.
  const isPreviewCategory = !isSubAgent && disclosure === "preview";

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
      <span className="shrink-0 text-muted-foreground" aria-hidden="true">
        <CategoryIcon />
      </span>

      <span className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0 font-medium text-foreground">
          {displayLabel}
        </span>
        {subtitleIsFilePath && primaryArg ? (
          <FilePathLink
            path={primaryArg}
            className="min-w-0 text-xs text-muted-foreground"
          />
        ) : (
          displaySubtitle && (
            <span
              ref={measuresSubtitle ? subtitleRef : undefined}
              title={displaySubtitle}
              className="min-w-0 truncate text-muted-foreground font-mono"
            >
              {displaySubtitle}
            </span>
          )
        )}
        {!isSubAgent && category !== "shell" && resultSummary && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {resultSummary}
          </span>
        )}
      </span>

      {trailingContent}
    </>
  );

  // Preview layout: a plain (non-button) header above an always-visible body.
  // The body renders only when it has something to show — a pending gate, or a
  // non-empty result — so a no-output shell (which normalizes to an `empty`
  // result) stays a clean one-line row, never an empty padded box.
  if (isPreviewCategory) {
    const showBody = approval != null || result.type !== "empty";
    return (
      <div
        data-cursor-target="tool-call-row"
        className={cn(cardClass, className)}
      >
        <div className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs">
          {headerInner}
        </div>
        {showBody && (
          <div className="px-2.5 pb-2.5 pt-1" data-cursor-target="tool-preview">
            {body}
          </div>
        )}
      </div>
    );
  }

  // Summary / sub-agent layout: a chevron-gated header disclosing a body hidden
  // by default. The header is a div[role=button], not a <button>, because it
  // carries the nested "Inspect tool call" <button> (a <button> may not contain
  // another); Enter/Space drive the toggle for keyboard parity.
  return (
    <div
      data-cursor-target="tool-call-row"
      className={cn(cardClass, className)}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
          "hover:bg-muted-subtle",
          // ring-inset so the card's overflow-hidden does not clip the focus ring.
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          expanded && "bg-muted-faint",
        )}
      >
        {headerInner}
        <ChevronIcon expanded={expanded} />
      </div>

      {expanded && <div className="px-2.5 pb-2.5 pt-1">{body}</div>}
    </div>
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
      return { label: "Approved", colorClass: "bg-success/15 text-success" };
    case ApprovalAction.SKIP:
      return { label: "Skipped", colorClass: "bg-muted text-muted-foreground" };
    case ApprovalAction.REJECT:
      return { label: "Rejected", colorClass: "bg-destructive/15 text-destructive" };
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
  pending: { label: "Pending review", colorClass: "bg-warning/15 text-warning" },
  kept: { label: "Kept", colorClass: "bg-success/15 text-success" },
  discarded: { label: "Discarded", colorClass: "bg-destructive/15 text-destructive" },
  failed: { label: "Review failed", colorClass: "bg-destructive/15 text-destructive" },
};

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

type ItemStatus = "running" | "waiting" | "failed" | "completed" | "pending";

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
    default:
      return "pending";
  }
}

const STATUS_COLOR: Record<ItemStatus, string> = {
  running: "text-foreground",
  waiting: "text-warning",
  failed: "text-destructive",
  completed: "text-success",
  pending: "text-muted-foreground",
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
// Status icons
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<ItemStatus, () => React.JSX.Element> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: CheckCircleIcon,
  pending: DotIcon,
};

function SpinnerIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4 6L5.5 7.5L8 4.5" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4.5 4.5L7.5 7.5M7.5 4.5L4.5 7.5" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <circle cx="4" cy="4" r="2.5" />
    </svg>
  );
}

function InspectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="3.5" />
      <path d="M8 8L10.5 10.5" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 text-muted-foreground transition-transform duration-150",
        expanded && "rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
