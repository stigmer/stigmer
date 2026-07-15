"use client";

import { memo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { useAutoScroll } from "../../internal/useAutoScroll.js";
import { JumpToLatestButton } from "../../internal/JumpToLatestButton.js";
import { BoundedContent } from "../../internal/BoundedContent.js";
import { formatMetaChips } from "../format-utils.js";
import { useWorkflowThreadItems } from "./useWorkflowThreadItems.js";
import type {
  WorkflowThreadItem,
  WorkflowThreadProgress,
} from "./project-thread-items.js";

/** Props for {@link WorkflowTaskThread}. */
export interface WorkflowTaskThreadProps {
  /** Live derived task states from the execution event stream. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Total planned tasks (from `execution_started`); `0` when unknown. */
  readonly totalTasks: number;
  /** Whether the execution is still running (drives streaming affordances). */
  readonly isRunning: boolean;
  /** The task selected across the viewer (thread, graph, and panel). */
  readonly selectedTaskName: string | null;
  /**
   * Callback when the user selects a task card (or re-clicks the selected
   * card to deselect — `null`). Same contract as a graph node click: the
   * viewer opens the panel's Inspect facet on an explicit selection.
   */
  readonly onTaskSelect?: (taskName: string | null) => void;
  /**
   * Callback to open an AGENT_CALL task's child transcript in the panel's
   * editor area (the S4 in-place expansion). Omitted → the affordance is
   * not rendered.
   */
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Session-style task thread for a workflow execution: one card per task in
 * execution order (first-started first — D-T02-1), streaming live as the
 * run progresses, with a collapsed preview and an expandable detail body
 * per card — the workflow analog of the session viewer's tool-call cards.
 *
 * Pending tasks render no cards (D-T02-5); the progress header keeps
 * overall status visible. Retries collapse into one card with an attempt
 * indicator (D-T02-6). AGENT_CALL cards expand to a summary plus an
 * "Open transcript" affordance (D-T02-2) — the full transcript opens as a
 * panel document, never inline. Selecting a card is the "show me this
 * task" gesture (it opens Inspect), matching a DAG node click.
 *
 * Auto-follow uses the session thread's mechanism: an IntersectionObserver
 * sentinel keeps the list pinned to the latest card until the user scrolls
 * up, with a jump-to-latest affordance to re-engage.
 *
 * This component is designed to work identically whether rendered in the
 * Stigmer Console or embedded in a third-party dashboard. No dependencies
 * on Console routing, auth, or layout context.
 */
export const WorkflowTaskThread = memo(function WorkflowTaskThread({
  taskStates,
  totalTasks,
  isRunning,
  selectedTaskName,
  onTaskSelect,
  onOpenAgentExecution,
  className,
}: WorkflowTaskThreadProps) {
  const { items, progress } = useWorkflowThreadItems(taskStates, totalTasks);
  const { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest } =
    useAutoScroll();

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      <ThreadProgressHeader progress={progress} isRunning={isRunning} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4"
        >
          {items.length === 0 ? (
            <ThreadEmptyState isRunning={isRunning} />
          ) : (
            items.map((item) => (
              <ThreadTaskCard
                key={item.taskName}
                item={item}
                isSelected={item.taskName === selectedTaskName}
                onTaskSelect={onTaskSelect}
                onOpenAgentExecution={onOpenAgentExecution}
              />
            ))
          )}
          <div ref={sentinelRef} aria-hidden="true" />
        </div>
      </div>

      <JumpToLatestButton visible={!isFollowing} onClick={jumpToLatest} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Progress header
// ---------------------------------------------------------------------------

function ThreadProgressHeader({
  progress,
  isRunning,
}: {
  readonly progress: WorkflowThreadProgress;
  readonly isRunning: boolean;
}) {
  const { settledTasks, activeTasks, totalTasks } = progress;
  const settled =
    totalTasks > 0
      ? `${settledTasks} of ${totalTasks} tasks`
      : `${settledTasks} ${settledTasks === 1 ? "task" : "tasks"}`;

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
      <span>{settled}</span>
      {activeTasks > 0 && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full bg-primary",
              isRunning && "animate-pulse",
            )}
          />
          {activeTasks} active
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function ThreadEmptyState({ isRunning }: { readonly isRunning: boolean }) {
  return (
    <div role="status" className="px-4 py-10 text-center text-sm text-muted-foreground">
      {isRunning
        ? "Waiting for the first task to start…"
        : "No task activity was recorded for this execution."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

/**
 * One task card. Memoized against the structurally-shared item (DD-010):
 * during streaming only the actively-changing task's item gets a fresh
 * identity, so settled cards bail here. Expansion is local row state —
 * expanding one card never re-renders its siblings.
 */
const ThreadTaskCard = memo(function ThreadTaskCard({
  item,
  isSelected,
  onTaskSelect,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly isSelected: boolean;
  readonly onTaskSelect?: (taskName: string | null) => void;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Task names are user-authored (may contain spaces); sanitize for the id.
  const detailId = `stgm-thread-task-${item.taskName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const meta = formatMetaChips({
    durationMs: item.durationMs,
    costMicros: item.costMicros,
    tokens: item.tokensUsed,
  });
  const preview = collapsedPreview(item);

  return (
    <div
      className={cn(
        "rounded-md border bg-card",
        isSelected
          ? "border-primary ring-1 ring-primary"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        {/* The selection gesture — same contract as a DAG node click. */}
        <button
          type="button"
          aria-pressed={isSelected}
          onClick={() => onTaskSelect?.(isSelected ? null : item.taskName)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatusIcon status={item.status} />
          <span className="truncate text-sm font-medium text-foreground">
            {item.taskName}
          </span>
          {item.kindLabel && (
            <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              {item.kindLabel}
            </span>
          )}
          {item.attemptNumber > 1 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              attempt {item.attemptNumber}
            </span>
          )}
          {preview && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {preview}
            </span>
          )}
          {meta && (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {meta}
            </span>
          )}
        </button>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={expanded ? `Collapse ${item.taskName}` : `Expand ${item.taskName}`}
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronIcon expanded={expanded} />
        </button>
      </div>

      {expanded && (
        <div id={detailId} className="border-t border-border px-3 py-2">
          <ThreadTaskDetail
            item={item}
            onOpenAgentExecution={onOpenAgentExecution}
          />
        </div>
      )}
    </div>
  );
});

/**
 * Collapsed one-line preview per card variant — the thread's analog of the
 * session tool card's primary-arg line. Only fields already on the item
 * (i.e. on `DerivedTaskState`) appear here; deep detail stays in Inspect.
 */
function collapsedPreview(item: WorkflowThreadItem): string | null {
  if (item.status === "waiting_approval") return "Awaiting approval";
  if (item.status === "failed" && item.error) return firstLine(item.error);

  if (item.variant === "agent-call") {
    const parts: string[] = [];
    if (item.agentSlug) parts.push(item.agentSlug);
    if (item.status === "running" && item.currentToolName) {
      parts.push(`running ${item.currentToolName}`);
    }
    if (item.messagesCount > 0 || item.toolCallsCount > 0) {
      parts.push(`${item.messagesCount} msgs · ${item.toolCallsCount} tools`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (item.status === "skipped") return "Skipped";
  return null;
}

function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? text : text.slice(0, nl);
}

// ---------------------------------------------------------------------------
// Expanded detail body
// ---------------------------------------------------------------------------

function ThreadTaskDetail({
  item,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
}) {
  const rows: Array<[string, string]> = [["Status", statusLabel(item.status)]];
  if (item.durationMs > 0) {
    rows.push(["Duration", formatMetaChips({ durationMs: item.durationMs }) ?? ""]);
  }
  if (item.attemptNumber > 1) rows.push(["Attempt", String(item.attemptNumber)]);
  const costChip = formatMetaChips({
    costMicros: item.costMicros,
    tokens: item.tokensUsed,
  });
  if (costChip) rows.push(["Usage", costChip]);
  if (item.variant === "agent-call" && item.agentSlug) {
    rows.push(["Agent", item.agentSlug]);
  }

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {item.error && (
        <BoundedContent>
          <pre className="whitespace-pre-wrap break-words text-xs text-destructive">
            {item.error}
          </pre>
        </BoundedContent>
      )}

      {item.variant === "agent-call" &&
        item.childExecutionId &&
        onOpenAgentExecution && (
          <div>
            <button
              type="button"
              onClick={() =>
                onOpenAgentExecution(item.childExecutionId, item.taskName)
              }
              className="rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open transcript
            </button>
          </div>
        )}
    </div>
  );
}

function statusLabel(status: WorkflowThreadItem["status"]): string {
  switch (status) {
    case "waiting_approval":
      return "Waiting for approval";
    case "retrying":
      return "Retrying";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "pending":
      return "Pending";
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { readonly status: WorkflowThreadItem["status"] }) {
  switch (status) {
    case "running":
    case "retrying":
      return (
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary"
        />
      );
    case "waiting_approval":
      return (
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full bg-[var(--stgm-warning,#f59e0b)]"
        />
      );
    case "completed":
      return (
        <svg
          aria-hidden="true"
          className="size-3 shrink-0 text-[var(--stgm-success,#22c55e)]"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6.5L5 9L9.5 3.5" />
        </svg>
      );
    case "failed":
      return (
        <svg
          aria-hidden="true"
          className="size-3 shrink-0 text-destructive"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M3 3L9 9M9 3L3 9" />
        </svg>
      );
    case "skipped":
    case "pending":
      return (
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full border border-border"
        />
      );
  }
}

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform", expanded && "rotate-180")}
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}
