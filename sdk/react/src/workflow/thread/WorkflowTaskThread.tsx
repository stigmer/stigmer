"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type {
  WorkflowPendingApproval,
  WorkflowPendingFileReview,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { useAutoScroll } from "../../internal/useAutoScroll.js";
import { JumpToLatestButton } from "../../internal/JumpToLatestButton.js";
import { BoundedContent } from "../../internal/BoundedContent.js";
import { formatMetaChips } from "../format-utils.js";
import type { UseWorkflowExecutionActionsReturn } from "../useWorkflowExecutionActions.js";
import { WorkflowApprovalList } from "../WorkflowApprovalList.js";
import { WorkflowFileReviewList } from "../WorkflowFileReviewList.js";
import { useWorkflowThreadItems } from "./useWorkflowThreadItems.js";
import type {
  WorkflowThreadItem,
  WorkflowThreadProgress,
} from "./project-thread-items.js";

/**
 * The workflow-level HITL wiring a decision-capable thread needs — a `Pick`
 * of the single `useWorkflowExecutionActions` instance's return (cannot
 * drift; same convention as `WorkflowAgentExecutionHitl` and
 * `WorkflowInspectHitl`). Decisions route through the WORKFLOW-level RPCs
 * only — never the child's own `agentExecution.*` path, whose authorization
 * checks the runner-spawned child rather than the workflow execution the
 * operator owns (S5 rationale).
 */
export type WorkflowThreadHitl = Pick<
  UseWorkflowExecutionActionsReturn,
  | "submitApproval"
  | "approvalSubmittingToolCallIds"
  | "approvalErrorsByToolCallId"
  | "submitFileDecision"
  | "fileDecisionSubmittingKeys"
  | "fileDecisionErrorsByKey"
>;

/**
 * The pending gates surfaced for one task card's child agent execution —
 * grouped once per thread render (memoized against the snapshot lists) so
 * non-gating cards receive `undefined` and their `React.memo` bails hold.
 */
interface ThreadTaskGates {
  readonly approvals: readonly WorkflowPendingApproval[];
  readonly fileReviews: readonly WorkflowPendingFileReview[];
}

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
  /**
   * Workflow-level HITL wiring (see {@link WorkflowThreadHitl}). When
   * provided, a gating task's card renders its decision surface directly in
   * the thread — always visible while the gate is pending, never behind the
   * expand chevron (the run is blocked). Omitted → the thread is read-only
   * and behaves exactly as before (DD-011; the S5 omitted-`hitl` precedent).
   */
  readonly hitl?: WorkflowThreadHitl;
  /**
   * The parent workflow's surfaced child tool-approval gates
   * (`status.pending_approvals`). Only read when {@link hitl} is provided.
   */
  readonly pendingApprovals?: readonly WorkflowPendingApproval[];
  /**
   * The parent workflow's surfaced child file-review references
   * (`status.pending_file_reviews`). Only read when {@link hitl} is provided.
   */
  readonly pendingFileReviews?: readonly WorkflowPendingFileReview[];
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
 * With `hitl` wired, a gating task's card carries its decision surface
 * in-thread (S10): the canonical `ApprovalCard`s for child tool gates, the
 * child-streaming `FileReviewCard`s for file gates, and a one-click
 * "Open review" into the panel's Inspect Approval tab for task-level
 * (human_input) gates — whose custom review renderers stay panel-side.
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
  hitl,
  pendingApprovals,
  pendingFileReviews,
  className,
}: WorkflowTaskThreadProps) {
  const { items, progress } = useWorkflowThreadItems(taskStates, totalTasks);
  const { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest } =
    useAutoScroll();

  // Group the snapshot's gates by owning child ONCE per snapshot identity —
  // the lists change only on a snapshot refetch, never on stream event
  // appends, so during streaming every card's `gates` prop keeps a stable
  // reference (`undefined` for non-gating cards) and memoized rows bail
  // (DD-009/DD-010). Grouping is unconditional (it is cheap and usually
  // empty); rendering is gated on `hitl` at the card.
  const gatesByChild = useMemo((): ReadonlyMap<string, ThreadTaskGates> => {
    const map = new Map<
      string,
      { approvals: WorkflowPendingApproval[]; fileReviews: WorkflowPendingFileReview[] }
    >();
    const bucket = (childId: string) => {
      let entry = map.get(childId);
      if (!entry) {
        entry = { approvals: [], fileReviews: [] };
        map.set(childId, entry);
      }
      return entry;
    };
    for (const pa of pendingApprovals ?? []) {
      if (pa.childAgentExecutionId) bucket(pa.childAgentExecutionId).approvals.push(pa);
    }
    for (const ref of pendingFileReviews ?? []) {
      if (ref.childAgentExecutionId) bucket(ref.childAgentExecutionId).fileReviews.push(ref);
    }
    return map;
  }, [pendingApprovals, pendingFileReviews]);

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
                // HITL props reach ONLY gating cards (DD-010): the bundle's
                // identity moves whenever any gate's in-flight/error state
                // flips (fresh Set/Map fields), so handing it to every card
                // would re-render the whole column per spinner tick. Scoped
                // here, non-gating cards keep `undefined === undefined` and
                // their memo bails hold.
                hitl={item.status === "waiting_approval" ? hitl : undefined}
                gates={
                  item.status === "waiting_approval" && item.childExecutionId
                    ? gatesByChild.get(item.childExecutionId)
                    : undefined
                }
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
 * identity, so settled cards bail here. `hitl`/`gates` arrive ONLY while
 * this card is gating (the thread scopes them — see the render site), so
 * gate-state churn (a decision's in-flight Set flip re-materializes the
 * bundle) re-renders gating cards only, never the column. Expansion is
 * local row state — expanding one card never re-renders its siblings.
 */
const ThreadTaskCard = memo(function ThreadTaskCard({
  item,
  isSelected,
  onTaskSelect,
  onOpenAgentExecution,
  hitl,
  gates,
}: {
  readonly item: WorkflowThreadItem;
  readonly isSelected: boolean;
  readonly onTaskSelect?: (taskName: string | null) => void;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  readonly hitl?: WorkflowThreadHitl;
  readonly gates?: ThreadTaskGates;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Selection is shared across the viewer (graph node, Usage row, gate
  // auto-select) — when it lands on this card from OUTSIDE the thread, the
  // card may be off-screen. Reveal it on the selected edge only; `nearest`
  // makes an already-visible card (e.g. the user's own click) a no-op.
  // If this scrolls away from the bottom, the auto-follow sentinel
  // disengages follow mode — correct: the user is inspecting. Optional
  // call: jsdom has no `scrollIntoView`.
  useEffect(() => {
    if (!isSelected) return;
    cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isSelected]);

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
      ref={cardRef}
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

      {/* In-thread HITL (S10): the decision surface renders whenever the
          task is gating — ALWAYS visible, never behind the expand chevron
          (the run is blocked; Nielsen #1). A sibling of the header row, not
          nested in its button (no interactive nesting). */}
      {hitl && item.status === "waiting_approval" && (
        <div className="border-t border-border px-3 py-2">
          <ThreadTaskCardHitl
            item={item}
            gates={gates}
            hitl={hitl}
            onTaskSelect={onTaskSelect}
            onOpenAgentExecution={onOpenAgentExecution}
          />
        </div>
      )}

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

// ---------------------------------------------------------------------------
// In-thread HITL section (S10)
// ---------------------------------------------------------------------------

/**
 * The decision surface on a gating card, resolved by gate kind:
 *
 * 1. Child gates surfaced on the parent snapshot → the shipped lists
 *    (`WorkflowApprovalList` for tool approvals, `WorkflowFileReviewList`
 *    for file reviews), filtered to this card's child. Decisions route
 *    through the workflow-level RPCs on the supplied {@link
 *    WorkflowThreadHitl} bundle.
 * 2. An AGENT_CALL card with NO surfaced gates → the child is gated but the
 *    snapshot has no entries: on cloud a brief refetch window; on OSS the
 *    steady state until the T04 forwarder lands. The honest surface is the
 *    child's own transcript (the S5 in-place expansion renders the child's
 *    ApprovalCards) — offer it, never a dead-end spinner.
 * 3. Any other gating card → a task-level (human_input) gate. Its decision
 *    surface — outcomes, forms, custom review renderers — lives in the
 *    panel's Inspect Approval tab; selecting the task IS the existing
 *    gesture that opens it (deliberately select, not toggle: re-clicking
 *    must re-open a closed panel, which `notifySelection` supports).
 */
function ThreadTaskCardHitl({
  item,
  gates,
  hitl,
  onTaskSelect,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly gates?: ThreadTaskGates;
  readonly hitl: WorkflowThreadHitl;
  readonly onTaskSelect?: (taskName: string | null) => void;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
}) {
  const hasChildGates =
    !!gates && (gates.approvals.length > 0 || gates.fileReviews.length > 0);

  if (hasChildGates) {
    return (
      <div className="flex flex-col gap-3">
        {gates.approvals.length > 0 && (
          <WorkflowApprovalList
            pendingApprovals={gates.approvals}
            onSubmitApproval={hitl.submitApproval}
            submittingToolCallIds={hitl.approvalSubmittingToolCallIds}
            approvalErrors={hitl.approvalErrorsByToolCallId}
          />
        )}
        {gates.fileReviews.length > 0 && (
          <WorkflowFileReviewList
            pendingFileReviews={gates.fileReviews}
            onSubmitFileDecision={hitl.submitFileDecision}
            submittingDecisionKeys={hitl.fileDecisionSubmittingKeys}
            decisionErrors={hitl.fileDecisionErrorsByKey}
          />
        )}
      </div>
    );
  }

  if (item.variant === "agent-call") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          The called agent is waiting for an approval. Decide it in the
          agent&apos;s transcript.
        </p>
        {item.childExecutionId && onOpenAgentExecution && (
          <ThreadActionButton
            label="Open transcript"
            onClick={() =>
              onOpenAgentExecution(item.childExecutionId, item.taskName)
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted-foreground">
        Review required to continue this run.
      </p>
      {onTaskSelect && (
        <ThreadActionButton
          label="Open review"
          onClick={() => onTaskSelect(item.taskName)}
        />
      )}
    </div>
  );
}

function ThreadActionButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}

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
            <ThreadActionButton
              label="Open transcript"
              onClick={() =>
                onOpenAgentExecution(item.childExecutionId, item.taskName)
              }
            />
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
