"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type {
  WorkflowPendingApproval,
  WorkflowPendingFileReview,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { useAutoScroll } from "../../internal/useAutoScroll.js";
import { JumpToLatestButton } from "../../internal/JumpToLatestButton.js";
import { BoundedContent } from "../../internal/BoundedContent.js";
import { formatMetaChips } from "../format-utils.js";
import type { UseWorkflowExecutionActionsReturn } from "../useWorkflowExecutionActions.js";
import { WorkflowApprovalList } from "../WorkflowApprovalList.js";
import { WorkflowFileReviewList } from "../WorkflowFileReviewList.js";
import { buildIO, type TaskDetailIO } from "../task-detail/task-detail-io.js";
import { StructuredDataViewer } from "../task-detail/StructuredDataViewer.js";
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
   * card to deselect — `null`). Since T04 this is a highlight+scroll
   * gesture only — the card is the primary surface for the task's data, so
   * the viewer no longer force-opens the panel's Inspect facet on it (the
   * R1-2 fix). The explicit drill-down gesture is {@link onInspectTask}.
   */
  readonly onTaskSelect?: (taskName: string | null) => void;
  /**
   * Callback for the card's opt-in Inspect affordance (T04) — the
   * drill-down to raw structured I/O, the per-task event log, and retries
   * (the density the card intentionally does not inline). The viewer opens
   * the panel's Inspect facet on it. Also carries the human_input "Open
   * review" path. Omitted → the affordance is not rendered.
   */
  readonly onInspectTask?: (taskName: string) => void;
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
  /**
   * Per-task status snapshots (`status.tasks[]`) keyed by task name — the
   * FULL I/O source for card bodies (T04). An O(1) lookup per card, never
   * an event-log scan: the full `deriveTaskDetail` join stays in the
   * Inspect drill-down. The map's identity changes only on a snapshot
   * refetch (rare), never on stream event appends, so memoized cards keep
   * bailing during streaming. Omitted → bodies degrade to the truncated
   * event summaries already on the items.
   */
  readonly taskSnapshotsByName?: ReadonlyMap<string, WorkflowTask>;
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
 * indicator (D-T02-6). AGENT_CALL cards carry an always-visible body with
 * an "Open transcript" affordance (D-T02-2) — the full transcript opens as
 * a panel document, never inline. Since T04 the card is the PRIMARY surface
 * for a task's data (kind-aware preview line + bounded I/O body): selecting
 * a card highlights and scrolls but never force-opens the panel; the
 * per-card Inspect affordance is the explicit drill-down.
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
  onInspectTask,
  onOpenAgentExecution,
  hitl,
  pendingApprovals,
  pendingFileReviews,
  taskSnapshotsByName,
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
                onInspectTask={onInspectTask}
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
                snapshot={taskSnapshotsByName?.get(item.taskName)}
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
 * bundle) re-renders gating cards only, never the column. `snapshot`
 * changes identity only on a snapshot refetch, never on stream appends.
 * Expansion is local row state — expanding one card never re-renders its
 * siblings.
 *
 * Disclosure (T04, the session `ToolCallItem` rule — "does the body carry
 * content the one-line row cannot?"):
 * - `"preview"` kinds render an ALWAYS-VISIBLE bounded output body (no
 *   card chevron — `BoundedContent` owns its own in-place reveal, so the
 *   old "expand, then Show more" double control never comes back).
 * - `"summary"` kinds keep the chevron-gated detail body.
 */
const ThreadTaskCard = memo(function ThreadTaskCard({
  item,
  isSelected,
  onTaskSelect,
  onInspectTask,
  onOpenAgentExecution,
  hitl,
  gates,
  snapshot,
}: {
  readonly item: WorkflowThreadItem;
  readonly isSelected: boolean;
  readonly onTaskSelect?: (taskName: string | null) => void;
  readonly onInspectTask?: (taskName: string) => void;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  readonly hitl?: WorkflowThreadHitl;
  readonly gates?: ThreadTaskGates;
  readonly snapshot?: WorkflowTask;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // The I/O fallback ladder (full snapshot value → truncated event summary
  // → nothing) — an O(1) lookup, never an event-log scan (T04).
  const outputIO = useMemo(
    () => buildIO(snapshot?.output, item.outputSummary, snapshot?.artifactIds ?? []),
    [snapshot, item.outputSummary],
  );
  const inputIO = useMemo(
    () => buildIO(snapshot?.input, item.inputSummary, []),
    [snapshot, item.inputSummary],
  );

  const isPreview = item.disclosure === "preview";
  const showHitl = !!hitl && item.status === "waiting_approval";
  // While gating, the in-card HITL section owns the card's affordances
  // (including "Open transcript" when the child's gates aren't surfaced) —
  // the preview body must not render a duplicate.
  const showBodyTranscript =
    item.variant === "agent-call" &&
    !!item.childExecutionId &&
    !!onOpenAgentExecution &&
    !showHitl;
  // The session's `showBody` gate: a preview body renders only when it has
  // content the header cannot carry (output, an error, or the agent-call
  // transcript affordance) — a content-less preview card collapses back to
  // a clean one-line row.
  const showPreviewBody =
    isPreview && (outputIO !== null || !!item.error || showBodyTranscript);

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
  // Kind-aware one-liner resolved by `resolveTaskPreview` in the projection
  // (T04) — a primitive on the item so this memoized card bails during
  // streaming. The empty string means "nothing kind-specific to say".
  const preview = item.previewLine || null;

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

        {/* The opt-in drill-down (T04) — the session tool card's Inspect
            affordance: raw I/O, per-task events, retries in the panel. */}
        {onInspectTask && (
          <button
            type="button"
            aria-label={`Inspect ${item.taskName}`}
            onClick={() => onInspectTask(item.taskName)}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <InspectIcon />
          </button>
        )}

        {!isPreview && (
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
        )}
      </div>

      {/* In-thread HITL (S10): the decision surface renders whenever the
          task is gating — ALWAYS visible, never behind the expand chevron
          (the run is blocked; Nielsen #1). A sibling of the header row, not
          nested in its button (no interactive nesting). */}
      {showHitl && hitl && (
        <div className="border-t border-border px-3 py-2">
          <ThreadTaskCardHitl
            item={item}
            gates={gates}
            hitl={hitl}
            onTaskSelect={onTaskSelect}
            onInspectTask={onInspectTask}
            onOpenAgentExecution={onOpenAgentExecution}
          />
        </div>
      )}

      {/* Always-visible bounded output body for I/O-bearing kinds (T04) —
          the session's preview-card model. */}
      {showPreviewBody && (
        <div className="border-t border-border px-3 py-2">
          <ThreadTaskPreviewBody
            item={item}
            outputIO={outputIO}
            onOpenAgentExecution={
              showBodyTranscript ? onOpenAgentExecution : undefined
            }
          />
        </div>
      )}

      {!isPreview && expanded && (
        <div id={detailId} className="border-t border-border px-3 py-2">
          <ThreadTaskDetail
            item={item}
            inputIO={inputIO}
            outputIO={outputIO}
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
 *    panel's Inspect Approval tab; "Open review" routes through the
 *    Inspect drill-down (T04: a plain thread selection no longer opens the
 *    panel, so the review path must use the explicit force-open gesture).
 */
function ThreadTaskCardHitl({
  item,
  gates,
  hitl,
  onTaskSelect,
  onInspectTask,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly gates?: ThreadTaskGates;
  readonly hitl: WorkflowThreadHitl;
  readonly onTaskSelect?: (taskName: string | null) => void;
  readonly onInspectTask?: (taskName: string) => void;
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

  // T04: the review surface lives in the panel's Inspect Approval tab, and
  // a plain selection no longer opens the panel — route through the
  // explicit Inspect gesture (fall back to selection for embedders that
  // wired only `onTaskSelect`).
  const openReview = onInspectTask ?? onTaskSelect;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted-foreground">
        Review required to continue this run.
      </p>
      {openReview && (
        <ThreadActionButton
          label="Open review"
          onClick={() => openReview(item.taskName)}
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

// ---------------------------------------------------------------------------
// Card bodies (T04)
// ---------------------------------------------------------------------------

/**
 * One side of a task's I/O in the card, honest about provenance: the
 * event-summary rung of the fallback ladder carries the same truncation
 * banner Inspect uses. Bounded — the outer `BoundedContent` caps total
 * height (single-level with `StructuredDataViewer`'s per-value reveals:
 * different granularity, they never govern the same block).
 */
function ThreadTaskIOSection({
  label,
  io,
}: {
  readonly label: "Input" | "Output";
  readonly io: TaskDetailIO;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {io.source === "event-summary" && (
        <p className="text-[10px] text-muted-foreground">
          Showing truncated summary from the event log. Full data appears when
          the run's snapshot is available.
        </p>
      )}
      <BoundedContent>
        <StructuredDataViewer data={io.data} />
      </BoundedContent>
    </div>
  );
}

/**
 * The always-visible body of a `"preview"`-kind card: the task's output
 * (via the I/O fallback ladder), the failure detail when the task failed,
 * and the agent-call transcript affordance. Content only — the header owns
 * all metadata (session `ToolCallDetail` invariant).
 */
function ThreadTaskPreviewBody({
  item,
  outputIO,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly outputIO: TaskDetailIO | null;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {item.error && (
        <BoundedContent>
          <pre className="whitespace-pre-wrap break-words text-xs text-destructive">
            {item.error}
          </pre>
        </BoundedContent>
      )}

      {outputIO && <ThreadTaskIOSection label="Output" io={outputIO} />}

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

function ThreadTaskDetail({
  item,
  inputIO,
  outputIO,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly inputIO: TaskDetailIO | null;
  readonly outputIO: TaskDetailIO | null;
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

      {/* The task's I/O in the thread (T04) — all task detail belongs to
          the card; Inspect is the opt-in debug drill-down. */}
      {inputIO && <ThreadTaskIOSection label="Input" io={inputIO} />}
      {outputIO && <ThreadTaskIOSection label="Output" io={outputIO} />}

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

/** The session tool card's magnifier glyph (`ToolCallItem.InspectIcon`). */
function InspectIcon() {
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
    >
      <circle cx="5.5" cy="5.5" r="3.5" />
      <path d="M8 8L10.5 10.5" />
    </svg>
  );
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
