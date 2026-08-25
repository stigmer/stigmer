"use client";

import { memo, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
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
import { WorkflowAgentCallTranscript } from "../WorkflowAgentCallTranscript.js";
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

/** Props for {@link WorkflowTaskThread}. */
export interface WorkflowTaskThreadProps {
  /** Live derived task states from the execution event stream. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Total planned tasks (from `execution_started`); `0` when unknown. */
  readonly totalTasks: number;
  /** Whether the execution is still running (drives streaming affordances). */
  readonly isRunning: boolean;
  /**
   * Open an AGENT_CALL task's child execution as a standalone page — the
   * inline transcript's deep-dive pop-out. Host-routed (DD-004). Omitted →
   * the affordance is not rendered.
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /**
   * Workflow-level HITL wiring (see {@link WorkflowThreadHitl}). When
   * provided, a gating task's card renders its decision surface directly in
   * the thread — always visible while the gate is pending, never behind the
   * expand chevron (the run is blocked). Omitted → the thread is read-only
   * and behaves exactly as before (DD-011; the S5 omitted-`hitl` precedent).
   */
  readonly hitl?: WorkflowThreadHitl;
  /**
   * Per-task status snapshots (`status.tasks[]`) keyed by task name — the
   * FULL I/O source for card bodies (T04), never an event-log scan
   * (DD-T04-5). The map's identity changes only on a snapshot refetch
   * (rare), never on stream event appends, so memoized cards keep bailing
   * during streaming. Omitted → bodies degrade to the truncated event
   * summaries already on the items.
   */
  readonly taskSnapshotsByName?: ReadonlyMap<string, WorkflowTask>;
  /**
   * Scroll to the latest content when the reader submits a HITL decision
   * from a scrolled-up position (stigmer-cloud#267) — the workflow surface's
   * send-analog: approving a gate, deciding a file review, or answering a
   * task-level human_input gate re-engages follow mode, so the run's
   * continuation lands in view. Incoming task activity is unaffected — it
   * still never moves a scrolled-up reader. Default `true` on all three SDK
   * thread surfaces at once (the ratified DD-011 divergence — cross-surface
   * consistency is the point); set `false` to keep today's behavior.
   *
   * @default true
   */
  readonly scrollOnSend?: boolean;
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
 * indicator (D-T02-6). AGENT_CALL cards render the child's FULL transcript
 * inline as the card body (T07) — live-streaming while the child runs,
 * complete history once settled — the session experience in place, with an
 * "Open standalone" pop-out for a deep dive. Since T04 the card is the
 * PRIMARY surface for a task's data (kind-aware preview line + bounded I/O
 * body); since T06 it is the ONLY one — the Inspect drill-down is gone, and
 * cards compose the session card language exactly (expand-or-none headers,
 * no selection).
 *
 * Auto-follow uses the session thread's mechanism: an IntersectionObserver
 * sentinel keeps the list pinned to the latest card until the user scrolls
 * up, with a jump-to-latest affordance to re-engage.
 *
 * With `hitl` wired, a gating task's card carries its decision surface
 * in-thread (S10/T06/T07): the child's own inline transcript renders the
 * canonical `ApprovalCard`s and `FileReviewCard`s for child gates, and the
 * full `WorkflowTaskReviewGate` (custom review renderers included) renders
 * for task-level human_input gates — with a read-only
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
  onNavigateToAgentExecution,
  hitl,
  taskSnapshotsByName,
  scrollOnSend = true,
  className,
}: WorkflowTaskThreadProps) {
  const { items, progress } = useWorkflowThreadItems(taskStates, totalTasks);
  const { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest } =
    useAutoScroll();

  // Scroll-on-send (stigmer-cloud#267): submitting a decision pins the
  // thread before delegating, so the unblocked run's continuation lands in
  // view. The wrapper's identity moves with the bundle's — deliberate: the
  // bundle re-materializes exactly when its gate state flips (see the
  // render-site note below), and a stale wrapper would leak stale state
  // fields. `jumpToLatest` is referentially stable (useAutoScroll pins it).
  const threadHitl = useMemo<WorkflowThreadHitl | undefined>(() => {
    if (!hitl || !scrollOnSend) return hitl;
    return {
      ...hitl,
      submitApproval: (...args: Parameters<WorkflowThreadHitl["submitApproval"]>) => {
        jumpToLatest();
        return hitl.submitApproval(...args);
      },
      submitTaskApproval: (...args: Parameters<WorkflowThreadHitl["submitTaskApproval"]>) => {
        jumpToLatest();
        return hitl.submitTaskApproval(...args);
      },
      submitFileDecision: (...args: Parameters<WorkflowThreadHitl["submitFileDecision"]>) => {
        jumpToLatest();
        return hitl.submitFileDecision(...args);
      },
    };
  }, [hitl, scrollOnSend, jumpToLatest]);

  return (
    <div className={cn("stg:relative stg:flex stg:h-full stg:min-h-0 stg:flex-col", className)}>
      <ThreadProgressHeader progress={progress} isRunning={isRunning} />

      <div ref={scrollRef} className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto">
        <div
          ref={contentRef}
          className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:gap-2 stg:px-4 stg:py-4"
        >
          {items.length === 0 ? (
            <ThreadEmptyState isRunning={isRunning} />
          ) : (
            items.map((item) => (
              <ThreadTaskCard
                key={item.taskName}
                item={item}
                onNavigateToAgentExecution={onNavigateToAgentExecution}
                // HITL props reach ONLY gating cards (DD-010): the bundle's
                // identity moves whenever any gate's in-flight/error state
                // flips (fresh Set/Map fields), so handing it to every card
                // would re-render the whole column per spinner tick. Scoped
                // here, non-gating cards keep `undefined === undefined` and
                // their memo bails hold.
                hitl={item.status === "waiting_approval" ? threadHitl : undefined}
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
    <div className="stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-border stg:px-4 stg:py-1.5 stg:text-xs stg:text-muted-foreground">
      <span>{settled}</span>
      {activeTasks > 0 && (
        <span className="stg:flex stg:items-center stg:gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "stg:size-1.5 stg:rounded-full stg:bg-primary",
              isRunning && "stg:animate-pulse",
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
    <div role="status" className="stg:px-4 stg:py-10 stg:text-center stg:text-sm stg:text-muted-foreground">
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
 * identity, so settled cards bail here. `hitl` arrives ONLY while this
 * card is gating (the thread scopes it — see the render site), so
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
 *   gesture, the chevron appended by the shell (T06) — but ONLY when the
 *   detail body would carry content (stigmer#886): since R6-6 moved
 *   Status/Duration onto the header, a settled wait card often has
 *   nothing left to reveal, and a chevron that opens an empty body is
 *   worse than no chevron. The gate is the summary twin of
 *   `showPreviewBody` below.
 * - AGENT_CALL cards with a spawned child render the child's inline
 *   transcript as the body (T07) — keyed on the VARIANT, not the
 *   disclosure, so a platform builder's presenter override can never route
 *   the flagship card away from its transcript. An agent_call that failed
 *   BEFORE spawning a child (agent resolution error) has no transcript and
 *   falls back to the generic preview body so its error still surfaces.
 */
const ThreadTaskCard = memo(function ThreadTaskCard({
  item,
  onNavigateToAgentExecution,
  hitl,
  snapshot,
}: {
  readonly item: WorkflowThreadItem;
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  readonly hitl?: WorkflowThreadHitl;
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
  // The flagship card (T07): an AGENT_CALL with a spawned child renders the
  // child's transcript inline as its body — the single home for everything
  // the child did. Child gates decide INSIDE the transcript (the session's
  // own ApprovalCard/FileReviewDock), so the generic HITL section below is
  // for task-level (human_input) gates only.
  const showTranscript =
    item.variant === "agent-call" && item.childExecutionId !== "";
  const showHitl =
    !!hitl && item.status === "waiting_approval" && !showTranscript;
  // A resolved human_input gate presents its decision report in place of
  // the raw output Struct (the output IS the decision record — the report
  // is the readable rendering of it).
  const showApprovalSummary =
    !showHitl && approvalRequestView !== null && approvalDecision !== null;
  // The session's `showBody` gate: a preview body renders only when it has
  // content the header cannot carry (output, an error, or a gate's
  // decision report) — a content-less preview card collapses back to a
  // clean one-line row. Transcript cards have their own body.
  const showPreviewBody =
    !showTranscript &&
    isPreview &&
    (outputIO !== null || !!item.error || showApprovalSummary);
  // The summary twin of that gate (stigmer#886): the expand gesture exists
  // only when `ThreadTaskDetail` would render something. Short-circuits
  // before the row build for preview/transcript cards, which never render
  // the detail body.
  const summaryHasDetail =
    !isPreview &&
    !showTranscript &&
    (taskDetailRows(item).length > 0 ||
      !!item.error ||
      inputIO !== null ||
      outputIO !== null);

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
      {/* The session card's gestures exactly (T06): summary rows with a
          content-bearing detail expand from the header (chevron appended
          by the shell); preview, transcript, and body-less summary rows
          are plain layout rows. */}
      <ThreadCardHeader
        gesture={
          summaryHasDetail
            ? {
                kind: "expand",
                expanded,
                onToggle: () => setExpanded((v) => !v),
              }
            : { kind: "none" }
        }
      >
        <StatusGlyph status={item.status} />
        <span className="stg:min-w-0 stg:flex-1 stg:flex stg:items-baseline stg:gap-1.5 stg:overflow-hidden">
          <span className="stg:shrink-0 stg:font-medium stg:text-foreground">
            {item.taskName}
          </span>
          {item.kindLabel && (
            <span className="stg:shrink-0 stg:rounded stg:border stg:border-border stg:px-1 stg:py-px stg:text-[10px] stg:uppercase stg:tracking-wide stg:text-muted-foreground">
              {item.kindLabel}
            </span>
          )}
          {item.attemptNumber > 1 && (
            <span className="stg:shrink-0 stg:text-muted-foreground">
              attempt {item.attemptNumber}
            </span>
          )}
          {preview && (
            <span className="stg:min-w-0 stg:truncate stg:text-muted-foreground">
              {preview}
            </span>
          )}
        </span>

        {meta && (
          <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
            {meta}
          </span>
        )}
      </ThreadCardHeader>

      {/* In-thread HITL (S10/T06): the task-level (human_input) decision
          surface renders whenever the task is gating — ALWAYS visible,
          never behind the expand chevron (the run is blocked; Nielsen #1).
          Child gates are NOT rendered here — they decide inside the
          transcript body below (T07). */}
      {showHitl && hitl && (
        <ThreadCardBody>
          <ThreadTaskCardHitl
            item={item}
            hitl={hitl}
            approvalRequestView={approvalRequestView}
          />
        </ThreadCardBody>
      )}

      {/* The child's inline transcript — the agent-call card's body for
          every state: streaming while the child runs, full history once
          settled, the child's own gates decided in place (T07). The task's
          own error (e.g. "child execution failed") renders above it. */}
      {showTranscript && (
        <ThreadCardBody cursorTarget="task-transcript">
          <div className="stg:flex stg:flex-col stg:gap-2">
            {item.error && (
              <BoundedContent>
                <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-destructive">
                  {item.error}
                </pre>
              </BoundedContent>
            )}
            {/* Carries the card's (wrapped) bundle: a child-gate decision
                inside this transcript is a send too, and the gating card is
                the thread's active tail — pinning the outer thread keeps
                the transcript's continuation in view as it streams. */}
            <WorkflowAgentCallTranscript
              childExecutionId={item.childExecutionId}
              agentSlug={item.agentSlug || undefined}
              hitl={hitl}
              onNavigateToAgentExecution={onNavigateToAgentExecution}
            />
          </div>
        </ThreadCardBody>
      )}

      {/* Always-visible bounded output body for I/O-bearing kinds (T04) —
          the session's preview-card model. Also the fallback for an
          agent_call that failed before spawning a child (no transcript to
          show; the error must still surface). */}
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
          />
        </ThreadCardBody>
      )}

      {summaryHasDetail && expanded && (
        <ThreadCardBody>
          <ThreadTaskDetail item={item} inputIO={inputIO} outputIO={outputIO} />
        </ThreadCardBody>
      )}
    </ThreadCardShell>
  );
});

// ---------------------------------------------------------------------------
// In-thread HITL section (S10)
// ---------------------------------------------------------------------------

/**
 * The decision surface on a gating card — since T07 this is the task-level
 * (human_input) gate only. Child gates (tool approvals, file reviews) are
 * the inline transcript's job: an AGENT_CALL card's body renders the
 * child's own `ApprovalCard`s and `FileReviewDock`, so this section never
 * renders for transcript cards (see `showHitl` at the card).
 *
 * The full review surface — outcomes, forms, artifact-backed payloads,
 * custom review renderers — renders right here (T06): the card is the only
 * decision surface, so it carries the real `WorkflowTaskReviewGate`, not a
 * link to one. Degrades to an honest waiting notice when the request
 * payload is unavailable (no event stream — the snapshot fallback path).
 */
function ThreadTaskCardHitl({
  item,
  hitl,
  approvalRequestView,
}: {
  readonly item: WorkflowThreadItem;
  readonly hitl: WorkflowThreadHitl;
  readonly approvalRequestView: TaskApprovalRequestView | null;
}) {
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
    <p className="stg:text-xs stg:text-muted-foreground">
      Review required to continue this run.
    </p>
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
    <div className="stg:flex stg:flex-col stg:gap-1">
      <span className="stg:text-[10px] stg:font-medium stg:uppercase stg:tracking-wide stg:text-muted-foreground">
        {label}
      </span>
      {io.source === "event-summary" && (
        <p className="stg:text-[10px] stg:text-muted-foreground">
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
 * (via the I/O fallback ladder) and the failure detail when the task
 * failed. Content only — the header owns all metadata (session
 * `ToolCallDetail` invariant). AGENT_CALL cards with a spawned child never
 * reach this body — theirs is the inline transcript (T07).
 *
 * A resolved human_input gate supplies `approvalSummary` and gets the
 * read-only decision report instead of the raw output Struct — the output
 * IS the decision record, and the report is its readable rendering (T06).
 */
function ThreadTaskPreviewBody({
  item,
  outputIO,
  approvalSummary,
}: {
  readonly item: WorkflowThreadItem;
  readonly outputIO: TaskDetailIO | null;
  readonly approvalSummary?: {
    readonly request: TaskApprovalRequestView;
    readonly decision: TaskDetailApprovalDecision | null;
  };
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {item.error && (
        <BoundedContent>
          <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-destructive">
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
    </div>
  );
}

/**
 * The detail body's label/value rows. No Status/Duration rows (R6-6): the
 * card header is the single source for both — the status glyph and the
 * duration meta chip. The detail carries only what the header cannot:
 * attempt count, usage, the agent slug. Shared with the card's
 * `summaryHasDetail` gate so "would the body render anything?" can never
 * drift from what the body actually renders (stigmer#886).
 */
function taskDetailRows(item: WorkflowThreadItem): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (item.attemptNumber > 1) rows.push(["Attempt", String(item.attemptNumber)]);
  const costChip = formatMetaChips({
    costMicros: item.costMicros,
    tokens: item.tokensUsed,
  });
  if (costChip) rows.push(["Usage", costChip]);
  if (item.variant === "agent-call" && item.agentSlug) {
    rows.push(["Agent", item.agentSlug]);
  }
  return rows;
}

function ThreadTaskDetail({
  item,
  inputIO,
  outputIO,
}: {
  readonly item: WorkflowThreadItem;
  readonly inputIO: TaskDetailIO | null;
  readonly outputIO: TaskDetailIO | null;
}) {
  const rows = taskDetailRows(item);

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {rows.length > 0 && (
        <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-4 stg:gap-y-1 stg:text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="stg:contents">
              <dt className="stg:text-muted-foreground">{label}</dt>
              <dd className="stg:text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {item.error && (
        <BoundedContent>
          <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-destructive">
            {item.error}
          </pre>
        </BoundedContent>
      )}

      {/* The task's I/O in the thread (T04) — all task detail belongs to
          the card; Inspect is the opt-in debug drill-down. */}
      {inputIO && <ThreadTaskIOSection label="Input" io={inputIO} />}
      {outputIO && <ThreadTaskIOSection label="Output" io={outputIO} />}
    </div>
  );
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
  running: { Icon: SpinnerIcon, color: "stg:text-foreground" },
  retrying: { Icon: SpinnerIcon, color: "stg:text-warning" },
  waiting_approval: { Icon: ClockIcon, color: "stg:text-warning" },
  completed: { Icon: CheckCircleIcon, color: "stg:text-success" },
  failed: { Icon: XCircleIcon, color: "stg:text-destructive" },
  skipped: { Icon: SlashCircleIcon, color: "stg:text-muted-foreground" },
  pending: { Icon: DotIcon, color: "stg:text-muted-foreground" },
};

function StatusGlyph({ status }: { readonly status: WorkflowThreadItem["status"] }) {
  const { Icon, color } = STATUS_GLYPH[status];
  return (
    <span className={cn("stg:shrink-0", color)} aria-hidden="true">
      <Icon />
    </span>
  );
}
