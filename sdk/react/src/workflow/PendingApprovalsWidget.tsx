"use client";

import { memo } from "react";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { cn } from "@stigmer/theme";

export interface PendingApprovalsWidgetProps {
  readonly approvals: readonly PendingApproval[];
  readonly totalCount: number;
  readonly isLoading: boolean;
  /** Called when the user clicks "Review" on an approval. */
  readonly onReviewClick?: (executionId: string) => void;
  readonly className?: string;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Dashboard widget showing pending human_input approvals.
 *
 * Displays a compact list of workflow tasks awaiting reviewer decisions,
 * with workflow name, task name, waiting duration, and a review action.
 *
 * All visuals use `--stgm-*` tokens. No hardcoded colors.
 */
export const PendingApprovalsWidget = memo(function PendingApprovalsWidget({
  approvals,
  totalCount,
  isLoading,
  onReviewClick,
  className,
}: PendingApprovalsWidgetProps) {
  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="flex items-center justify-between">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-8 animate-pulse rounded bg-muted" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg border border-border bg-muted/50"
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Pending Approvals
        </h3>
        {totalCount > 0 && (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            {totalCount}
          </span>
        )}
      </div>

      {approvals.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No approvals pending
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {approvals.map((approval) => {
            const requestedAt = approval.requestedAt
              ? timestampDate(approval.requestedAt)
              : null;

            return (
              <li
                key={`${approval.executionId}-${approval.taskName}`}
                className="rounded-lg border border-border px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {approval.workflowName || approval.executionId}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Task: {approval.taskName}
                      {requestedAt && (
                        <> &middot; {formatTimeAgo(requestedAt)}</>
                      )}
                    </p>
                  </div>
                  {onReviewClick && (
                    <button
                      type="button"
                      onClick={() => onReviewClick(approval.executionId)}
                      className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Review
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
