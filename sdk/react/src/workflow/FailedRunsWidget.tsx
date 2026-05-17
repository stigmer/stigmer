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
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
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
      <h3 className="text-sm font-semibold text-foreground">
        Recent Failures
      </h3>

      {executions.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No recent failures
        </p>
      ) : (
        <ul className="space-y-2" role="list">
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
                className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {name}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-destructive">
                      {errorMsg}
                    </p>
                    {failedDate && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatTimeAgo(failedDate)}
                      </p>
                    )}
                  </div>
                  {onViewClick && id && (
                    <button
                      type="button"
                      onClick={() => onViewClick(id)}
                      className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
