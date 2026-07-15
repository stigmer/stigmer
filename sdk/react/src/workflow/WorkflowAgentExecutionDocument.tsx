"use client";

// Editor-area document rendering one child AgentExecution's full transcript.
// Domain: workflow (the AGENT_CALL counterpart of WorkflowArtifactDocument).

import { memo, useCallback, useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileChangeSetStatus,
  type FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { displayFileChangeSets } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { useLiveAgentExecution } from "../execution/useLiveAgentExecution.js";
import { MessageThread } from "../execution/MessageThread.js";
import { ThreadSkeleton } from "../execution/ThreadSkeleton.js";
import { ExecutionPhaseBadge } from "../execution/ExecutionPhaseBadge.js";
import { FileReviewDock } from "../execution/FileReviewDock.js";
import type { FileDecisionOptions } from "../execution/useFileReview.js";
import { isTerminalPhase } from "../execution/execution-phases.js";
import type { UseWorkflowExecutionActionsReturn } from "./useWorkflowExecutionActions.js";

/** Stable empty list so the thread's memoized rows keep identity (DD-010). */
const EMPTY_EXECUTIONS: readonly AgentExecution[] = [];

/**
 * The HITL wiring for a child transcript: the slice of
 * {@link UseWorkflowExecutionActionsReturn} the document needs to submit
 * child-gate decisions at the WORKFLOW level.
 *
 * A `Pick` (not a new shape) so the bundle can never drift from the actions
 * hook — the viewer builds it from its single `useWorkflowExecutionActions`
 * instance, which is the same keyed in-flight/error state the bottom
 * Approvals tab renders. One instance, two surfaces: a spinner or failure on
 * a gate is identical wherever that gate is shown.
 */
export type WorkflowAgentExecutionHitl = Pick<
  UseWorkflowExecutionActionsReturn,
  | "submitApproval"
  | "approvalSubmittingToolCallIds"
  | "approvalErrorsByToolCallId"
  | "submitFileDecision"
  | "fileDecisionSubmittingKeys"
  | "fileDecisionErrorsByKey"
>;

/** Props for {@link WorkflowAgentExecutionDocument}. */
export interface WorkflowAgentExecutionDocumentProps {
  /** ID of the child AgentExecution whose transcript to render. */
  readonly childExecutionId: string;
  /** The AGENT_CALL task that spawned the child — the document's title. */
  readonly taskName: string;
  /** Slug of the agent the task called, when known (subtitle context). */
  readonly agentSlug?: string;
  /**
   * Open the child execution as a standalone page — the pop-out escape hatch
   * preserved from the inspector's Agent tab. Host-routed (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /**
   * Workflow-level HITL handlers (S5 of the UX-parity project). When
   * provided, the transcript becomes interactive: tool-approval gates render
   * their decision cards inline on the gated rows, and pending file reviews
   * dock at the bottom of the document. When omitted, the transcript is
   * read-only — gates show status only (backward compatible, DD-011).
   */
  readonly hitl?: WorkflowAgentExecutionHitl;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The editor-pane rendering of a child AgentExecution's transcript — the
 * `SurfaceVirtualDocument` body the workflow execution panel mounts when an
 * AGENT_CALL task is opened in place (S4 of the UX-parity project). This is
 * the full session-grade experience — streaming `MessageThread` with tool
 * calls, sub-agents, plan cards, and (with {@link
 * WorkflowAgentExecutionDocumentProps.hitl | hitl}) in-place HITL —
 * replacing the inspector's cramped `max-h-[50vh]` thumbnail.
 *
 * HITL ROUTING. Child gates are decided through the WORKFLOW-level RPCs
 * (`WorkflowExecution.submitApproval` / `submitFileDecision`), never the
 * child's own `agentExecution.*` submit path. The two paths are
 * server-equivalent (the workflow RPC forwards to the child — see
 * workflowexecution command.proto), but they differ in authorization: the
 * workflow RPC checks `can_edit` on the workflow execution — the resource
 * the operator owns — while the child path checks the runner-spawned
 * AgentExecution, which the operator may not. Every workflow HITL surface
 * (bottom Approvals tab, inspector) routes this way; the transcript joins
 * them via the same actions instance, so in-flight/error state never forks.
 *
 * FILE-REVIEW DOCK. Pending (AWAITING_REVIEW) sets derive from the CHILD's
 * own live stream — the freshest source this document already holds — not
 * from the parent's `status.pending_file_reviews`: the parent snapshot is
 * fetched once at mount and may lag a mid-run gate, which would blank the
 * dock exactly when the reviewer is watching live. The server validates
 * routing against its own (fresh) stored status at submit time, so a
 * too-early decision degrades to a retryable in-card error, the same
 * treatment tool approvals get. Docked below the thread (mirroring the
 * session's composer dock) so a decision the agent is blocked on can never
 * scroll out of view; settled sets render as read-only records in-thread
 * (`showFileReviewRecords`), never in the dock — the two surfaces partition
 * by the same pending test `MessageThread` uses.
 *
 * Lifecycle: the surface's editor area mounts only the ACTIVE virtual
 * document, so `useLiveAgentExecution` fetches/streams only while this tab
 * is foregrounded (DD-LIVE-006 — at most one child stream is ever live) and
 * a tab-return re-renders instantly from the DD-014 fetch cache.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export const WorkflowAgentExecutionDocument = memo(
  function WorkflowAgentExecutionDocument({
    childExecutionId,
    taskName,
    agentSlug,
    onNavigateToAgentExecution,
    hitl,
    className,
  }: WorkflowAgentExecutionDocumentProps) {
    const { execution, phase, isLoading, isStreaming, isReconnecting, error, reconnect } =
      useLiveAgentExecution(childExecutionId);

    // Pending file reviews from the child's own (streamed) status — see the
    // component doc for why the parent's pending_file_reviews is not the
    // source. Terminal executions never dock: their AWAITING_REVIEW sets are
    // settled history ("not reviewed") and render as in-thread records — the
    // exact complement of MessageThread's pending test, so no set ever
    // appears in both surfaces.
    const terminal = isTerminalPhase(phase);
    const pendingReviewSets = useMemo<readonly FileChangeSet[]>(() => {
      if (terminal) return [];
      return displayFileChangeSets(execution?.status).filter(
        (cs) =>
          cs.status === FileChangeSetStatus.AWAITING_REVIEW &&
          cs.changes.length > 0,
      );
    }, [execution?.status, terminal]);

    // Bind the child id into the dock's card-level submit signature. Deps are
    // the specific method (DD-010), so the callback survives unrelated
    // in-flight churn on the actions instance.
    const submitFileDecision = hitl?.submitFileDecision;
    const handleFileDecision = useCallback(
      (changeSetId: string, action: FileDecisionAction, options?: FileDecisionOptions) => {
        submitFileDecision?.(childExecutionId, changeSetId, action, options);
      },
      [submitFileDecision, childExecutionId],
    );

    return (
      <div
        role="article"
        aria-label={`Agent execution for task ${taskName}`}
        className={cn("flex h-full min-w-0 flex-col", className)}
      >
        {/* Slim identity header: task name (the DAG node this transcript
            belongs to), agent slug, live/phase state, and the standalone
            pop-out. Wraps on narrow panes rather than overflowing. */}
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-4 py-2">
          <span className="truncate text-sm font-medium text-foreground">
            {taskName}
          </span>
          {agentSlug && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {agentSlug}
            </span>
          )}

          <span className="shrink-0">
            {isStreaming ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                Live
              </span>
            ) : isReconnecting ? (
              <span className="text-xs text-muted-foreground">Reconnecting…</span>
            ) : isTerminalPhase(phase) ? (
              <ExecutionPhaseBadge phase={phase} />
            ) : null}
          </span>

          {onNavigateToAgentExecution && (
            <button
              type="button"
              onClick={() => onNavigateToAgentExecution(childExecutionId)}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            >
              <PopOutIcon />
              Open standalone
            </button>
          )}
        </div>

        {/* The thread owns the scrolling (its auto-scroll machine + jump-to-
            latest need the scroll container); h-full keeps the surrounding
            editor-pane wrapper inert, so there is exactly one scrollbar. */}
        <div className="min-h-0 min-w-0 flex-1">
          {execution ? (
            <MessageThread
              executions={EMPTY_EXECUTIONS}
              activeStreamExecution={execution}
              onApprovalSubmit={hitl?.submitApproval}
              submittingApprovalIds={hitl?.approvalSubmittingToolCallIds}
              approvalErrors={hitl?.approvalErrorsByToolCallId}
              showFileReviewRecords={hitl != null}
              className="h-full"
            />
          ) : isLoading ? (
            <ThreadSkeleton className="px-4 py-4" />
          ) : error ? (
            <div
              role="alert"
              className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-8 text-center"
            >
              <p className="text-xs text-destructive">{error.message}</p>
              <button
                type="button"
                onClick={reconnect}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </div>
          ) : (
            <div
              role="status"
              className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-8 text-center"
            >
              <p className="text-xs font-medium text-foreground">
                This agent execution is no longer available.
              </p>
              <p className="text-xs text-muted-foreground">
                It may have been removed, or the workflow run predates
                transcript retention.
              </p>
            </div>
          )}
        </div>

        {/* Pending file reviews dock here — pinned below the thread (the
            document has no composer, so the panel bottom is the fixed strip)
            where the decision the child is blocked on can never scroll out
            of view. Same shape as the session's composer dock. */}
        {hitl && pendingReviewSets.length > 0 && (
          <FileReviewDock
            changeSets={pendingReviewSets}
            onSubmit={handleFileDecision}
            submittingDecisionKeys={hitl.fileDecisionSubmittingKeys}
            decisionErrors={hitl.fileDecisionErrorsByKey}
            className="shrink-0"
          />
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function PopOutIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M10.5 4.5V1.5H7.5" />
      <path d="M10.5 1.5L6 6" />
      <path d="M8.5 7v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </svg>
  );
}
