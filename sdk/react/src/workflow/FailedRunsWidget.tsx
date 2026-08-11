"use client";

import { memo } from "react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { cn } from "@stigmer/theme";

export interface FailedRunsWidgetProps {
  /** Recent failed executions to display. */
  readonly executions: readonly WorkflowExecution[];
  readonly isLoading: boolean;
  /** Called when the user clicks "View" on a failed execution. */
  readonly onViewClick?: (executionId: string) => void;
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
 * Dashboard widget showing recent failed workflow executions.
 *
 * Consumes data from `useWorkflowExecutionList({ phase: EXECUTION_FAILED })`.
 * Displays a compact list with execution name, error summary, and time of failure.
 *
 * All visuals use `--stgm-*` tokens. No hardcoded colors.
 */
export const FailedRunsWidget = memo(function FailedRunsWidget({
  executions,
  isLoading,
  onViewClick,
  className,
}: FailedRunsWidgetProps) {
  if (isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-24 stg:animate-pulse stg:rounded stg:bg-muted" />
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
      <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
        Recent Failures
      </h3>

      {executions.length === 0 ? (
        <p className="stg:py-4 stg:text-center stg:text-xs stg:text-muted-foreground">
          No recent failures
        </p>
      ) : (
        <ul className="stg:space-y-2" role="list">
          {executions.map((exec) => {
            const id = exec.metadata?.id;
            const name =
              exec.metadata?.name || exec.metadata?.slug || "Unnamed";
            const errorMsg = exec.status?.error || "Unknown error";
            const failedAt = exec.status?.audit?.specAudit?.updatedAt;
            const failedDate = failedAt ? timestampDate(failedAt) : null;

            return (
              <li
                key={id}
                className="stg:rounded-lg stg:border stg:border-destructive/20 stg:bg-destructive/5 stg:px-3 stg:py-2.5"
              >
                <div className="stg:flex stg:items-start stg:justify-between stg:gap-2">
                  <div className="stg:min-w-0 stg:flex-1">
                    <p className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
                      {name}
                    </p>
                    <p className="stg:mt-0.5 stg:line-clamp-1 stg:text-xs stg:text-destructive">
                      {errorMsg}
                    </p>
                    {failedDate && (
                      <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
                        {formatTimeAgo(failedDate)}
                      </p>
                    )}
                  </div>
                  {onViewClick && id && (
                    <button
                      type="button"
                      onClick={() => onViewClick(id)}
                      className="stg:shrink-0 stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground stg:transition-colors stg:hover:bg-accent stg:hover:text-accent-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
                    >
                      View
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
