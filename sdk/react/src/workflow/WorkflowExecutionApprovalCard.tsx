"use client";

import { memo, useCallback, useEffect, useState } from "react";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { DecisionButton } from "../internal/DecisionButton";
import { InCardDecisionError } from "../internal/InCardDecisionError";

/** Props for {@link WorkflowExecutionApprovalCard}. */
export interface WorkflowExecutionApprovalCardProps {
  /** The prompt message explaining what needs approval. */
  readonly prompt: string;
  /** Tool call ID for the approval request. */
  readonly toolCallId: string;
  /** List of users/roles that can approve. */
  readonly approvers: readonly string[];
  /** Timeout in seconds (0 = no timeout). */
  readonly timeoutSeconds: number;
  /** Callback to submit the approval decision. */
  readonly onSubmitApproval: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<unknown>;
  /** `true` while this gate's submission is in flight. */
  readonly isSubmitting: boolean;
  /**
   * This gate's last failed decision, or `null`. Surfaced in-card beside the
   * actions (via the shared {@link InCardDecisionError}) — supply
   * {@link useWorkflowExecutionActions}'s `approvalErrorsByToolCallId` for this
   * `toolCallId`.
   */
  readonly error?: Error | null;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Inline approval card rendered within the execution timeline when
 * a `human_input` task or agent tool approval gate is active.
 *
 * Provides approve and reject buttons with an optional comment field.
 * Keyboard-navigable and accessible.
 */
export const WorkflowExecutionApprovalCard = memo(function WorkflowExecutionApprovalCard({
  prompt,
  toolCallId,
  approvers,
  timeoutSeconds,
  onSubmitApproval,
  isSubmitting,
  error,
  className,
}: WorkflowExecutionApprovalCardProps) {
  const [comment, setComment] = useState("");
  // Which action is in flight, so the spinner lands on the clicked button —
  // matching ApprovalCard / WorkflowTaskApprovalCard. Reset once the RPC settles.
  const [active, setActive] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    if (!isSubmitting) setActive(null);
  }, [isSubmitting]);

  // ApprovalAction enum values: 0=UNSPECIFIED, 1=APPROVE, 2=SKIP, 3=REJECT
  const handleApprove = useCallback(() => {
    setActive("approve");
    onSubmitApproval(toolCallId, 1 as ApprovalAction, comment || undefined);
  }, [toolCallId, comment, onSubmitApproval]);

  const handleReject = useCallback(() => {
    setActive("reject");
    onSubmitApproval(toolCallId, 3 as ApprovalAction, comment || undefined);
  }, [toolCallId, comment, onSubmitApproval]);

  return (
    <div
      role="alert"
      aria-label="Approval required"
      // Neutral card + 2px warning left accent — the quiet Cursor-grade chrome
      // shared with ApprovalCard. (Replaces the old amber `bg-warning/5` fill.)
      className={cn(
        "my-1 rounded-lg border border-border-prominent border-l-2 border-l-warning p-3",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{prompt}</p>

      {approvers.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Approvers: {approvers.join(", ")}
        </p>
      )}

      {timeoutSeconds > 0 && (
        <p className="text-xs text-muted-foreground">
          Expires in {formatTimeout(timeoutSeconds)}
        </p>
      )}

      <div className="mt-2">
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Comment (optional)"
          disabled={isSubmitting}
          className={cn(
            "w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:opacity-50",
          )}
        />
      </div>

      <div className="mt-2 flex gap-2">
        <DecisionButton
          label="Approve"
          variant="primary"
          onClick={handleApprove}
          isActive={active === "approve"}
          isSubmitting={isSubmitting}
        />
        <DecisionButton
          label="Reject"
          variant="danger"
          onClick={handleReject}
          isActive={active === "reject"}
          isSubmitting={isSubmitting}
        />
      </div>

      {/* A failed decision surfaces HERE, beside this gate's actions — not in the
          viewer's lifecycle banner. A workflow can hold many gates at once, so a
          failure must name the one it belongs to; the optimistic spinner has
          already reverted, and this explains the snap-back. Shared with the
          agent ApprovalCard / FileReviewCard via InCardDecisionError. */}
      {error && (
        <InCardDecisionError
          error={error}
          leadIn="submit decision"
          cursorTarget="wf-approval-error"
        />
      )}
    </div>
  );
});

function formatTimeout(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
