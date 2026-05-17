"use client";

import { memo, useCallback, useState } from "react";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

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
  /** `true` while a submission is in flight. */
  readonly isSubmitting: boolean;
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
  className,
}: WorkflowExecutionApprovalCardProps) {
  const [comment, setComment] = useState("");

  // ApprovalAction enum values: 0=UNSPECIFIED, 1=APPROVE, 2=SKIP, 3=REJECT
  const handleApprove = useCallback(() => {
    onSubmitApproval(toolCallId, 1 as ApprovalAction, comment || undefined);
  }, [toolCallId, comment, onSubmitApproval]);

  const handleReject = useCallback(() => {
    onSubmitApproval(toolCallId, 3 as ApprovalAction, comment || undefined);
  }, [toolCallId, comment, onSubmitApproval]);

  return (
    <div
      role="alert"
      aria-label="Approval required"
      className={cn(
        "my-1 rounded-lg border border-warning/30 bg-warning/5 p-3",
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
        <button
          type="button"
          onClick={handleApprove}
          disabled={isSubmitting}
          className={cn(
            "rounded px-3 py-1 text-xs font-medium",
            "bg-success text-success-foreground",
            "hover:bg-success/90 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={isSubmitting}
          className={cn(
            "rounded border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive",
            "hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Reject
        </button>
      </div>
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
