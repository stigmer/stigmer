"use client";

import { useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { ToolCallDetail, formatDuration } from "./ToolCallDetail";
import { SubAgentSection } from "./SubAgentSection";
import { FilePathLink } from "./FilePathLink";
import {
  resolveToolCategory,
  extractPrimaryArg,
  type ToolCategory,
} from "./tool-categories";
import { useSandboxNormalize } from "./SandboxContext";

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
   * Initial expansion state. Defaults to `false`.
   */
  readonly defaultExpanded?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a single tool call as a row in the tool call group.
 *
 * Two rendering modes:
 *
 * - **Non-expandable** (completed/skipped Read): a static `<div>` row
 *   with a clickable {@link FilePathLink}. No chevron, no expansion.
 *   The clickable path IS the complete information.
 * - **Expandable** (all other tools): a `<button>` row that toggles a
 *   {@link ToolCallDetail} or {@link SubAgentSection} detail panel.
 *
 * Shows category-aware labels (e.g., "Shell", "Read", "Edit") with
 * the primary argument as a subtitle, a category-specific icon, and
 * an inline approval decision badge when applicable.
 *
 * @example
 * ```tsx
 * <ToolCallItem toolCall={tc} />
 * <ToolCallItem toolCall={tc} subAgentExecution={sub} />
 * ```
 */
export function ToolCallItem({
  toolCall,
  subAgentExecution,
  defaultExpanded = false,
  className,
}: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const status = mapToolCallStatus(toolCall);
  const StatusIcon = STATUS_ICON[status];
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const isSubAgent = subAgentExecution != null;

  const categoryInfo = resolveToolCategory(toolCall.name, toolCall.mcpServerSlug);
  const CategoryIcon = CATEGORY_ICON[categoryInfo.category];
  const primaryArg = extractPrimaryArg(toolCall);

  const displayLabel = isSubAgent
    ? subAgentExecution.subject || subAgentExecution.name || categoryInfo.label
    : categoryInfo.label;

  const normalize = useSandboxNormalize();
  const approvalBadge = getApprovalBadge(toolCall);

  // Completed/skipped Read items are non-expandable — the clickable
  // path in the row is the complete information. Failed reads remain
  // expandable to show the error.
  const isNonExpandableRead =
    !isSubAgent &&
    categoryInfo.category === "read" &&
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
    </>
  );

  if (isNonExpandableRead) {
    return (
      <div className={cn("border-b border-border-muted last:border-b-0", className)}>
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

  const displaySubtitle = isSubAgent
    ? null
    : categoryInfo.category === "shell" && primaryArg
      ? normalize(primaryArg)
      : primaryArg;

  return (
    <div className={cn("border-b border-border-muted last:border-b-0", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
          "hover:bg-muted-subtle",
          expanded && "bg-muted-faint",
        )}
      >
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          <CategoryIcon />
        </span>

        <span className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground">
            {displayLabel}
          </span>
          {displaySubtitle && (
            <span className="min-w-0 truncate text-muted-foreground font-mono">
              {displaySubtitle}
            </span>
          )}
        </span>

        {trailingContent}

        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1">
          {isSubAgent ? (
            <SubAgentSection subAgentExecution={subAgentExecution} collapsible={false} />
          ) : (
            <ToolCallDetail toolCall={toolCall} />
          )}
        </div>
      )}
    </div>
  );
}

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
  think: BrainIcon,
  "sub-agent": BotIcon,
  internal: WrenchIcon,
  mcp: McpPlugIcon,
  unknown: WrenchIcon,
};

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
