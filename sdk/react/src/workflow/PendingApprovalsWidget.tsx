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
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:flex stg:items-center stg:justify-between">
          <div className="stg:h-4 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-4 stg:w-8 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="stg:h-14 stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted/50"
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      <div className="stg:flex stg:items-center stg:justify-between">
        <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
          Pending Approvals
        </h3>
        {totalCount > 0 && (
          <span className="stg:rounded-full stg:bg-warning/10 stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium stg:text-warning">
            {totalCount}
          </span>
        )}
      </div>

      {approvals.length === 0 ? (
        <p className="stg:py-4 stg:text-center stg:text-xs stg:text-muted-foreground">
          No approvals pending
        </p>
      ) : (
        <ul className="stg:space-y-2" role="list">
          {approvals.map((approval) => {
            const requestedAt = approval.requestedAt
              ? timestampDate(approval.requestedAt)
              : null;

            return (
              <li
                key={`${approval.executionId}-${approval.taskName}`}
                className="stg:rounded-lg stg:border stg:border-border stg:px-3 stg:py-2.5"
              >
                <div className="stg:flex stg:items-start stg:justify-between stg:gap-2">
                  <div className="stg:min-w-0 stg:flex-1">
                    <div className="stg:flex stg:items-center stg:gap-1.5">
                      <p className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
                        {approval.workflowName || approval.executionId}
                      </p>
                      {approval.uiHint && (
                        <span className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
                          {approval.uiHint}
                        </span>
                      )}
                    </div>
                    <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
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
                      className="stg:shrink-0 stg:rounded-md stg:bg-primary stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-primary-foreground stg:transition-colors stg:hover:bg-primary-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
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
