"use client";

import { memo, useMemo, useState } from "react";
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
import {
  ThreadCardShell,
  ThreadCardHeader,
  ThreadCardBody,
  SpinnerIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  DotIcon,
  SlashCircleIcon,
} from "../../internal/thread-card/index.js";
import { formatMetaChips } from "../format-utils.js";
import type { UseWorkflowExecutionActionsReturn } from "../useWorkflowExecutionActions.js";
import { WorkflowApprovalList } from "../WorkflowApprovalList.js";
import { WorkflowFileReviewList } from "../WorkflowFileReviewList.js";
import { WorkflowTaskReviewGate } from "../WorkflowTaskReviewGate.js";
import { WorkflowTaskApprovalSummary } from "../WorkflowTaskApprovalSummary.js";
import { buildIO, type TaskDetailIO } from "../task-detail/task-detail-io.js";
import {
  deriveTaskApprovalRequest,
  deriveTaskApprovalDecision,
  type TaskApprovalRequestView,
  type TaskDetailApprovalDecision,
} from "../task-detail/task-approval.js";
import { StructuredDataViewer } from "../task-detail/StructuredDataViewer.js";
import { useWorkflowThreadItems } from "./useWorkflowThreadItems.js";
import type {
  WorkflowThreadItem,
  WorkflowThreadProgress,
} from "./project-thread-items.js";

/**
 * The workflow-level HITL wiring a decision-capable thread needs — a `Pick`
 * of the single `useWorkflowExecutionActions` instance's return (cannot
 * drift; same convention as `WorkflowAgentExecutionHitl`). Covers all three
 * gate kinds: child tool approvals, child file reviews, and task-level
 * (human_input) approvals — since T06 the gating card is the ONLY decision
 * surface, so the thread carries the full set. Decisions route through the
 * WORKFLOW-level RPCs only — never the child's own `agentExecution.*` path,
 * whose authorization checks the runner-spawned child rather than the
 * workflow execution the operator owns (S5 rationale).
 */
export type WorkflowThreadHitl = Pick<
  UseWorkflowExecutionActionsReturn,
  | "submitApproval"
  | "approvalSubmittingToolCallIds"
  | "approvalErrorsByToolCallId"
  | "submitTaskApproval"
  | "taskApprovalSubmittingTaskNames"
  | "taskApprovalErrorsByTaskName"
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
   * FULL I/O source for card bodies (T04), never an event-log scan
   * (DD-T04-5). The map's identity changes only on a snapshot refetch
   * (rare), never on stream event appends, so memoized cards keep bailing
   * during streaming. Omitted → bodies degrade to the truncated event
   * summaries already on the items.
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
 * for a task's data (kind-aware preview line + bounded I/O body); since T06
 * it is the ONLY one — the Inspect drill-down is gone, and cards compose
 * the session card language exactly (expand-or-none headers, no selection).
 *
 * Auto-follow uses the session thread's mechanism: an IntersectionObserver
 * sentinel keeps the list pinned to the latest card until the user scrolls
 * up, with a jump-to-latest affordance to re-engage.
 *
 * With `hitl` wired, a gating task's card carries its decision surface
 * in-thread (S10/T06): the canonical `ApprovalCard`s for child tool gates,
 * the child-streaming `FileReviewCard`s for file gates, and the full
 * `WorkflowTaskReviewGate` (custom review renderers included) for
 * task-level human_input gates — with a read-only
 * `WorkflowTaskApprovalSummary` once the gate resolves.
 *
 * This component is designed to work identically whether rendered in the
 * Stigmer Console or embedded in a third-party dashboard. No dependencies
 * on Console routing, auth, or layout context.
 */
export const WorkflowTaskThread = memo(function WorkflowTaskThread({
  taskStates,
  totalTasks,
  isRunning,
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
 * - `"summary"` kinds expand from the header — the session card's own
 *   gesture, the chevron appended by the shell (T06).
 */
const ThreadTaskCard = memo(function ThreadTaskCard({
  item,
  onOpenAgentExecution,
  hitl,
  gates,
  snapshot,
}: {
  readonly item: WorkflowThreadItem;
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  readonly hitl?: WorkflowThreadHitl;
  readonly gates?: ThreadTaskGates;
  readonly snapshot?: WorkflowTask;
}) {
  const [expanded, setExpanded] = useState(false);

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

  // The human_input gate record (T06): the review material for a pending
  // gate, the decision report for a resolved one. Memoized on the captured
  // payloads' identities — the store keeps them reference-stable, so these
  // recompute only when a gate opens/resolves or the snapshot refetches.
  const approvalRequestView = useMemo(
    () =>
      item.approvalRequest
        ? deriveTaskApprovalRequest(item.approvalRequest)
        : null,
    [item.approvalRequest],
  );
  const approvalDecision = useMemo(
    () =>
      item.approvalRequest
        ? deriveTaskApprovalDecision(item.approvalResolution, snapshot?.output)
        : null,
    [item.approvalRequest, item.approvalResolution, snapshot],
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
  // A resolved human_input gate presents its decision report in place of
  // the raw output Struct (the output IS the decision record — the report
  // is the readable rendering of it).
  const showApprovalSummary =
    !showHitl && approvalRequestView !== null && approvalDecision !== null;
  // The session's `showBody` gate: a preview body renders only when it has
  // content the header cannot carry (output, an error, the agent-call
  // transcript affordance, or a gate's decision report) — a content-less
  // preview card collapses back to a clean one-line row.
  const showPreviewBody =
    isPreview &&
    (outputIO !== null ||
      !!item.error ||
      showBodyTranscript ||
      showApprovalSummary);

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
    <ThreadCardShell
      accent={item.status === "waiting_approval" ? "warning" : null}
      cursorTarget="workflow-task-row"
    >
      {/* The session card's gestures exactly (T06): summary rows expand
          from the header (chevron appended by the shell); preview rows'
          bodies are always visible, so the header is a plain layout row. */}
      <ThreadCardHeader
        gesture={
          isPreview
            ? { kind: "none" }
            : {
                kind: "expand",
                expanded,
                onToggle: () => setExpanded((v) => !v),
              }
        }
      >
        <StatusGlyph status={item.status} />
        <span className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground">
            {item.taskName}
          </span>
          {item.kindLabel && (
            <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              {item.kindLabel}
            </span>
          )}
          {item.attemptNumber > 1 && (
            <span className="shrink-0 text-muted-foreground">
              attempt {item.attemptNumber}
            </span>
          )}
          {preview && (
            <span className="min-w-0 truncate text-muted-foreground">
              {preview}
            </span>
          )}
        </span>

        {meta && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {meta}
          </span>
        )}
      </ThreadCardHeader>

      {/* In-thread HITL (S10): the decision surface renders whenever the
          task is gating — ALWAYS visible, never behind the expand chevron
          (the run is blocked; Nielsen #1). */}
      {showHitl && hitl && (
        <ThreadCardBody>
          <ThreadTaskCardHitl
            item={item}
            gates={gates}
            hitl={hitl}
            approvalRequestView={approvalRequestView}
            onOpenAgentExecution={onOpenAgentExecution}
          />
        </ThreadCardBody>
      )}

      {/* Always-visible bounded output body for I/O-bearing kinds (T04) —
          the session's preview-card model. */}
      {showPreviewBody && (
        <ThreadCardBody cursorTarget="task-preview">
          <ThreadTaskPreviewBody
            item={item}
            outputIO={outputIO}
            approvalSummary={
              showApprovalSummary && approvalRequestView
                ? {
                    request: approvalRequestView,
                    decision: approvalDecision,
                  }
                : undefined
            }
            onOpenAgentExecution={
              showBodyTranscript ? onOpenAgentExecution : undefined
            }
          />
        </ThreadCardBody>
      )}

      {!isPreview && expanded && (
        <ThreadCardBody>
          <ThreadTaskDetail
            item={item}
            inputIO={inputIO}
            outputIO={outputIO}
            onOpenAgentExecution={onOpenAgentExecution}
          />
        </ThreadCardBody>
      )}
    </ThreadCardShell>
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
 * 3. Any other gating card → a task-level (human_input) gate. The full
 *    review surface — outcomes, forms, artifact-backed payloads, custom
 *    review renderers — renders right here (T06): the card is the only
 *    decision surface, so it carries the real `WorkflowTaskReviewGate`,
 *    not a link to one. Degrades to an honest waiting notice when the
 *    request payload is unavailable (no event stream — the snapshot
 *    fallback path).
 */
function ThreadTaskCardHitl({
  item,
  gates,
  hitl,
  approvalRequestView,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly gates?: ThreadTaskGates;
  readonly hitl: WorkflowThreadHitl;
  readonly approvalRequestView: TaskApprovalRequestView | null;
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

  if (approvalRequestView) {
    return (
      <WorkflowTaskReviewGate
        taskName={item.taskName}
        prompt={approvalRequestView.prompt}
        outcomes={approvalRequestView.outcomes}
        formSchema={approvalRequestView.formSchema ?? undefined}
        payload={approvalRequestView.payload}
        uiHint={approvalRequestView.uiHint}
        payloadArtifactId={approvalRequestView.payloadArtifactId}
        onSubmit={hitl.submitTaskApproval}
        isSubmitting={hitl.taskApprovalSubmittingTaskNames.has(item.taskName)}
        error={hitl.taskApprovalErrorsByTaskName.get(item.taskName) ?? null}
      />
    );
  }

  // No captured request payload (event stream unavailable) — state the
  // block honestly rather than rendering a gate with no material.
  return (
    <p className="text-xs text-muted-foreground">
      Review required to continue this run.
    </p>
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
 *
 * A resolved human_input gate supplies `approvalSummary` and gets the
 * read-only decision report instead of the raw output Struct — the output
 * IS the decision record, and the report is its readable rendering (T06).
 */
function ThreadTaskPreviewBody({
  item,
  outputIO,
  approvalSummary,
  onOpenAgentExecution,
}: {
  readonly item: WorkflowThreadItem;
  readonly outputIO: TaskDetailIO | null;
  readonly approvalSummary?: {
    readonly request: TaskApprovalRequestView;
    readonly decision: TaskDetailApprovalDecision | null;
  };
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

      {approvalSummary ? (
        <WorkflowTaskApprovalSummary
          taskName={item.taskName}
          prompt={approvalSummary.request.prompt}
          outcomes={approvalSummary.request.outcomes}
          decision={approvalSummary.decision}
        />
      ) : (
        outputIO && <ThreadTaskIOSection label="Output" io={outputIO} />
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
// Status glyph — the shared thread-card set, colored by status token (T05)
// ---------------------------------------------------------------------------

/**
 * Maps a task's derived status onto the shared glyph vocabulary the session
 * tool card uses (`internal/thread-card/glyphs`), colored strictly through
 * status token classes — the old dot set's hardcoded hex fallbacks were a
 * Dont-Do #3 violation and died with it.
 */
const STATUS_GLYPH: Record<
  WorkflowThreadItem["status"],
  { readonly Icon: () => React.JSX.Element; readonly color: string }
> = {
  running: { Icon: SpinnerIcon, color: "text-foreground" },
  retrying: { Icon: SpinnerIcon, color: "text-warning" },
  waiting_approval: { Icon: ClockIcon, color: "text-warning" },
  completed: { Icon: CheckCircleIcon, color: "text-success" },
  failed: { Icon: XCircleIcon, color: "text-destructive" },
  skipped: { Icon: SlashCircleIcon, color: "text-muted-foreground" },
  pending: { Icon: DotIcon, color: "text-muted-foreground" },
};

function StatusGlyph({ status }: { readonly status: WorkflowThreadItem["status"] }) {
  const { Icon, color } = STATUS_GLYPH[status];
  return (
    <span className={cn("shrink-0", color)} aria-hidden="true">
      <Icon />
    </span>
  );
}
