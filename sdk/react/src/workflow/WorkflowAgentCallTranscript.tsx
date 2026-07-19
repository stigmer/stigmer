"use client";

// The inline child-transcript body of an AGENT_CALL task card (T07): the
// card IS the session experience — live while running, full history when
// settled — replacing the S4 "Open transcript" document tab.

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
import { FileReviewDock } from "../execution/FileReviewDock.js";
import type { FileDecisionOptions } from "../execution/useFileReview.js";
import { isTerminalPhase } from "../execution/execution-phases.js";
import { useInViewport } from "../internal/useInViewport.js";
import type { UseWorkflowExecutionActionsReturn } from "./useWorkflowExecutionActions.js";

/** Stable empty list so the thread's memoized rows keep identity (DD-010). */
const EMPTY_EXECUTIONS: readonly AgentExecution[] = [];

/**
 * The HITL wiring for an inline child transcript: the slice of
 * {@link UseWorkflowExecutionActionsReturn} needed to submit child-gate
 * decisions at the WORKFLOW level.
 *
 * A `Pick` (not a new shape) so the bundle can never drift from the actions
 * hook — the viewer builds it from its single `useWorkflowExecutionActions`
 * instance, so a gate's in-flight spinner or failure is identical wherever
 * that gate is shown.
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

/** Props for {@link WorkflowAgentCallTranscript}. */
export interface WorkflowAgentCallTranscriptProps {
  /** ID of the child AgentExecution whose transcript to render. */
  readonly childExecutionId: string;
  /** Slug of the agent the task called, when known (labels the region). */
  readonly agentSlug?: string;
  /**
   * Workflow-level HITL handlers. When provided, the transcript is
   * interactive: tool-approval gates render their decision cards inline on
   * the gated rows, and pending file reviews dock at the bottom. When
   * omitted, the transcript is read-only — gates show status only
   * (backward compatible, DD-011).
   */
  readonly hitl?: WorkflowAgentExecutionHitl;
  /**
   * Open the child execution as a standalone page — the deep-dive escape
   * hatch now that the card is the transcript's single home. Host-routed
   * (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * A child AgentExecution's full transcript rendered inline in the
 * AGENT_CALL task card — the session-grade `MessageThread` (tool calls,
 * sub-agents, plan cards, and — with {@link
 * WorkflowAgentCallTranscriptProps.hitl | hitl} — in-place HITL), streaming
 * live while the child runs and serving the full history once settled.
 *
 * BOUNDED, NOT FULL-HEIGHT. The transcript caps at a generous viewport
 * fraction and owns its own scroll + auto-follow inside that box
 * (`MessageThread`'s scroll machine is reused unchanged). Once a transcript
 * hits its cap it stops growing, so the card height stabilizes and the
 * OUTER thread's auto-follow stops chasing it — the bound fixes both the
 * inner and the outer scroll ergonomics at once.
 *
 * VIEWPORT-GATED STREAMING. Every mounted card fetches its (DD-014-cached)
 * snapshot so the body renders immediately, but the live subscription opens
 * only while the card is on-screen (`useInViewport` → the hook's `live`
 * gate). Off-screen running children pause their stream and keep the
 * last-streamed snapshot visible (never a rewind); scrolling back — or
 * toggling back from the CSS-hidden Graph view — re-attaches in place. This
 * preserves the bounded-concurrency intent of the S4 single-active-tab
 * design (DD-LIVE-006) for fan-out workflows: N concurrent children cost at
 * most the streams the user can actually see.
 *
 * MINIMAL CHROME. The card header already owns the task's identity and
 * metrics (the `agentCallLine` preview: slug, current tool, message/tool
 * counts, plus duration/cost chips and the running/settled status glyph).
 * The transcript adds only what the header cannot express: a
 * `Reconnecting…` notice for the CHILD stream and the "Open standalone"
 * pop-out. Body = purely the conversation.
 *
 * HITL ROUTING. Child gates are decided through the WORKFLOW-level RPCs
 * (`WorkflowExecution.submitApproval` / `submitFileDecision`), never the
 * child's own `agentExecution.*` submit path. The two paths are
 * server-equivalent (the workflow RPC forwards to the child), but they
 * differ in authorization: the workflow RPC checks `can_edit` on the
 * workflow execution — the resource the operator owns — while the child
 * path checks the runner-spawned AgentExecution, which the operator may
 * not (the S5 rationale).
 *
 * FILE-REVIEW DOCK. Pending (AWAITING_REVIEW) sets derive from the CHILD's
 * own live stream — the freshest source this component already holds — not
 * from the parent's `status.pending_file_reviews`, which is fetched once
 * and may lag a mid-run gate. Docked below the thread so a decision the
 * child is blocked on can never scroll out of view; settled sets render as
 * read-only records in-thread (`showFileReviewRecords`) — the two surfaces
 * partition by the same pending test `MessageThread` uses.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export const WorkflowAgentCallTranscript = memo(
  function WorkflowAgentCallTranscript({
    childExecutionId,
    agentSlug,
    hitl,
    onNavigateToAgentExecution,
    className,
  }: WorkflowAgentCallTranscriptProps) {
    const { ref: viewportRef, isVisible } = useInViewport();
    const {
      execution,
      phase,
      isLoading,
      isReconnecting,
      error,
      reconnect,
    } = useLiveAgentExecution(childExecutionId, { live: isVisible });

    // Pending file reviews from the child's own (streamed) status — see the
    // component doc for why the parent's pending_file_reviews is not the
    // source. Terminal executions never dock: their AWAITING_REVIEW sets
    // are settled history and render as in-thread records instead.
    const terminal = isTerminalPhase(phase);
    const pendingReviewSets = useMemo<readonly FileChangeSet[]>(() => {
      if (terminal) return [];
      return displayFileChangeSets(execution?.status).filter(
        (cs) =>
          cs.status === FileChangeSetStatus.AWAITING_REVIEW &&
          cs.changes.length > 0,
      );
    }, [execution?.status, terminal]);

    // Bind the child id into the dock's card-level submit signature. Deps
    // are the specific method (DD-010), so the callback survives unrelated
    // in-flight churn on the actions instance.
    const submitFileDecision = hitl?.submitFileDecision;
    const handleFileDecision = useCallback(
      (changeSetId: string, action: FileDecisionAction, options?: FileDecisionOptions) => {
        submitFileDecision?.(childExecutionId, changeSetId, action, options);
      },
      [submitFileDecision, childExecutionId],
    );

    const showBar = isReconnecting || !!onNavigateToAgentExecution;

    return (
      <div
        ref={viewportRef}
        role="group"
        aria-label={
          agentSlug ? `Transcript of agent ${agentSlug}` : "Agent transcript"
        }
        className={cn("flex max-h-[60vh] min-w-0 flex-col", className)}
      >
        {/* Only what the card header cannot express: the child stream's
            reconnecting state and the standalone pop-out. */}
        {showBar && (
          <div className="flex min-w-0 shrink-0 items-center gap-3 pb-1.5">
            {isReconnecting && (
              <span className="text-xs text-muted-foreground">Reconnecting…</span>
            )}
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
        )}

        {/* The thread owns the scrolling inside the bounded box (its
            auto-scroll machine + jump-to-latest need the scroll container);
            min-h-0 lets the flex slot shrink to the cap. */}
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
            <ThreadSkeleton className="py-2" />
          ) : error ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 py-2"
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
            <div role="status" className="flex flex-col gap-1 py-2">
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

        {/* Pending file reviews dock below the thread, inside the bounded
            box — the decision the child is blocked on can never scroll out
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
