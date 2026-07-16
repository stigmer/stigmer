"use client";

import { memo, useCallback } from "react";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { WorkflowPendingApproval } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import { ApprovalCard } from "../execution/ApprovalCard.js";

/**
 * Submit handler for a workflow-level tool-approval decision, matching
 * `useWorkflowExecutionActions().submitApproval`. The tool-call id is bound per
 * card so the shared {@link ApprovalCard} only needs the card-level
 * `(action, comment)`.
 */
export type WorkflowApprovalSubmit = (
  toolCallId: string,
  action: ApprovalAction,
  comment?: string,
) => Promise<unknown> | void;

/** Props for {@link WorkflowApprovalList}. */
export interface WorkflowApprovalListProps {
  /**
   * The parent workflow's surfaced tool-approval gates
   * (`status.pending_approvals`) — each pairs a child's full
   * `PendingApproval` with the child agent execution to route the decision to.
   */
  readonly pendingApprovals: readonly WorkflowPendingApproval[];
  /** Forwards a decision to the child (see {@link WorkflowApprovalSubmit}). */
  readonly onSubmitApproval: WorkflowApprovalSubmit;
  /**
   * Tool-call ids whose decision is in flight (pass
   * `approvalSubmittingToolCallIds` straight through). Keyed per gate so
   * deciding one never spins another.
   */
  readonly submittingToolCallIds?: ReadonlySet<string>;
  /**
   * Per-gate failures, keyed by `toolCallId` (pass `approvalErrorsByToolCallId`
   * straight through) — surfaced in-card beside the gate that failed.
   */
  readonly approvalErrors?: ReadonlyMap<string, Error>;
  /**
   * Optional deep-link to open the gate's child agent execution in its own
   * view. When provided, each gate renders a "View agent execution"
   * affordance — with parallel children, it names which child a gate belongs
   * to. Routing is the host's responsibility (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders the child agent tool approvals surfaced on a parent
 * WorkflowExecution — the tool-approval sibling of {@link WorkflowFileReviewList},
 * reusing the session's canonical {@link ApprovalCard} so a gate reads
 * identically everywhere it appears (workflow bottom tab, inspector, in-place
 * transcript, agent session): same 4-action decision model (Approve / Skip /
 * Reject / Approve-all-of-class), same preview, same gate provenance.
 *
 * Unlike the file sibling, this list does NOT stream the referenced children:
 * `WorkflowPendingApproval.approval` already carries the child's full
 * projected `PendingApproval` (file-review content is reference-only on the
 * parent and must be dereferenced; approvals are copied whole). Same role,
 * simpler body.
 *
 * Decisions route through the WORKFLOW-level RPC (the supplied
 * `onSubmitApproval`, normally `useWorkflowExecutionActions().submitApproval`)
 * — never the child's own `agentExecution.*` path, whose authorization checks
 * the runner-spawned child rather than the workflow execution the operator
 * owns. Empty `pendingApprovals` renders nothing.
 */
export function WorkflowApprovalList({
  pendingApprovals,
  onSubmitApproval,
  submittingToolCallIds,
  approvalErrors,
  onNavigateToAgentExecution,
  className,
}: WorkflowApprovalListProps): React.ReactElement | null {
  if (pendingApprovals.length === 0) return null;

  return (
    <div className={cn("stgm space-y-3", className)}>
      {pendingApprovals.map((ref) => {
        // A surfaced gate without its approval payload cannot be decided
        // (there is no toolCallId to route) — skip rather than render a
        // dead card.
        if (!ref.approval) return null;
        const toolCallId = ref.approval.toolCallId;
        return (
          <WorkflowApprovalItem
            key={toolCallId || ref.childAgentExecutionId}
            approval={ref.approval}
            childAgentExecutionId={ref.childAgentExecutionId}
            onSubmitApproval={onSubmitApproval}
            isSubmitting={submittingToolCallIds?.has(toolCallId) ?? false}
            error={approvalErrors?.get(toolCallId) ?? null}
            onNavigateToAgentExecution={onNavigateToAgentExecution}
          />
        );
      })}
    </div>
  );
}

interface WorkflowApprovalItemProps {
  readonly approval: PendingApproval;
  readonly childAgentExecutionId: string;
  readonly onSubmitApproval: WorkflowApprovalSubmit;
  readonly isSubmitting: boolean;
  readonly error: Error | null;
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
}

/**
 * One gate: binds `toolCallId` into the card-level submit signature — the same
 * stabilization `MessageThread`'s internal `ApprovalCardRow` performs — so the
 * memoized {@link ApprovalCard} re-renders only when ITS gate's state moves,
 * not when a sibling gate is decided.
 */
const WorkflowApprovalItem = memo(function WorkflowApprovalItem({
  approval,
  childAgentExecutionId,
  onSubmitApproval,
  isSubmitting,
  error,
  onNavigateToAgentExecution,
}: WorkflowApprovalItemProps) {
  const toolCallId = approval.toolCallId;
  const handleSubmit = useCallback(
    (action: ApprovalAction, comment?: string) => {
      onSubmitApproval(toolCallId, action, comment);
    },
    [onSubmitApproval, toolCallId],
  );

  return (
    <div className="space-y-2">
      {onNavigateToAgentExecution && (
        <button
          type="button"
          onClick={() => onNavigateToAgentExecution(childAgentExecutionId)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          View agent execution
        </button>
      )}
      <ApprovalCard
        pendingApproval={approval}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        error={error}
      />
    </div>
  );
});
