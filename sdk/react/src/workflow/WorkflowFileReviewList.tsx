"use client";

import { useMemo } from "react";
import {
  FileChangeSetStatus,
  type FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkflowPendingFileReview } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { displayFileChangeSets } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { FileReviewCard } from "../execution/FileReviewCard";
import type { FileDecisionOptions } from "../execution/useFileReview";
import { useExecutionStream } from "../execution/useExecutionStream";

/**
 * Submit handler for a workflow-level file decision, matching
 * `useWorkflowExecutionActions().submitFileDecision`. The child id is bound per
 * card so the surface only needs the card-level `(action, options)`.
 */
export type WorkflowFileDecisionSubmit = (
  childAgentExecutionId: string,
  changeSetId: string,
  action: FileDecisionAction,
  options?: FileDecisionOptions,
) => void;

/** Props for {@link WorkflowFileReviewList}. */
export interface WorkflowFileReviewListProps {
  /**
   * The parent workflow's surfaced file-review references
   * (`status.pending_file_reviews`) — one entry per child agent execution.
   */
  readonly pendingFileReviews: readonly WorkflowPendingFileReview[];
  /** Forwards a decision to the child (see {@link WorkflowFileDecisionSubmit}). */
  readonly onSubmitFileDecision: WorkflowFileDecisionSubmit;
  /** In-flight decision keys (pass `fileDecisionSubmittingKeys` straight through). */
  readonly submittingDecisionKeys?: ReadonlySet<string>;
  /** Per-decision failures (pass `fileDecisionErrorsByKey` straight through). */
  readonly decisionErrors?: ReadonlyMap<string, Error>;
  /**
   * Optional deep-link to open the child agent execution in its own view. When
   * provided, each child's review renders a "View agent execution" affordance.
   * Routing is the host's responsibility (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders the child agent file reviews surfaced on a parent WorkflowExecution.
 *
 * Reference-only, derive-from-child: the parent status carries only
 * {@link WorkflowPendingFileReview} references (child id + change set ids). This
 * list mounts one {@link WorkflowChildFileReview} per referenced child, which
 * streams that child's execution and reuses the agent-level {@link FileReviewCard}
 * to render the actual diff — the heavy content stays single-sourced on the child.
 * A decision is forwarded to the child via `WorkflowExecution.submitFileDecision`.
 *
 * This is the file-review sibling of the workflow tool-approval surface
 * (`WorkflowExecutionApprovalCard`). Empty `pendingFileReviews` renders nothing.
 */
export function WorkflowFileReviewList({
  pendingFileReviews,
  onSubmitFileDecision,
  submittingDecisionKeys,
  decisionErrors,
  onNavigateToAgentExecution,
  className,
}: WorkflowFileReviewListProps): React.ReactElement | null {
  if (pendingFileReviews.length === 0) return null;

  return (
    <div className={cn("stgm space-y-3", className)}>
      {pendingFileReviews.map((ref) => (
        <WorkflowChildFileReview
          key={ref.childAgentExecutionId}
          reference={ref}
          onSubmitFileDecision={onSubmitFileDecision}
          submittingDecisionKeys={submittingDecisionKeys}
          decisionErrors={decisionErrors}
          onNavigateToAgentExecution={onNavigateToAgentExecution}
        />
      ))}
    </div>
  );
}

interface WorkflowChildFileReviewProps {
  readonly reference: WorkflowPendingFileReview;
  readonly onSubmitFileDecision: WorkflowFileDecisionSubmit;
  readonly submittingDecisionKeys?: ReadonlySet<string>;
  readonly decisionErrors?: ReadonlyMap<string, Error>;
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
}

/**
 * Streams a single referenced child agent execution and renders its
 * AWAITING_REVIEW change sets (intersected with the parent's surfaced reference,
 * so a decision always targets a gate the workflow has actually surfaced).
 */
function WorkflowChildFileReview({
  reference,
  onSubmitFileDecision,
  submittingDecisionKeys,
  decisionErrors,
  onNavigateToAgentExecution,
}: WorkflowChildFileReviewProps): React.ReactElement | null {
  const childId = reference.childAgentExecutionId;
  const { execution } = useExecutionStream(childId);

  const changeSets = useMemo(() => {
    const referenced = new Set(reference.changeSetId);
    return displayFileChangeSets(execution?.status).filter(
      (cs) =>
        cs.status === FileChangeSetStatus.AWAITING_REVIEW &&
        referenced.has(cs.id) &&
        cs.changes.length > 0,
    );
  }, [execution?.status, reference.changeSetId]);

  // Nothing to show yet (child still loading, or its projection has not caught up
  // to the reference). The parent list already signals "review pending" for this
  // child by virtue of the reference existing.
  if (changeSets.length === 0) return null;

  return (
    <div className="space-y-2">
      {onNavigateToAgentExecution && (
        <button
          type="button"
          onClick={() => onNavigateToAgentExecution(childId)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          View agent execution
        </button>
      )}
      {changeSets.map((changeSet) => (
        <FileReviewCard
          key={changeSet.id}
          fileChangeSet={changeSet}
          interactive
          submittingDecisionKeys={submittingDecisionKeys}
          decisionErrors={decisionErrors}
          onSubmit={(action, options) =>
            onSubmitFileDecision(childId, changeSet.id, action, options)
          }
        />
      ))}
    </div>
  );
}
