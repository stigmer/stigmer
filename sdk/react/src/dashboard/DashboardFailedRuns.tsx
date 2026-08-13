"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import type { DashboardFailedRun } from "./types.js";
import { formatRelativeTime } from "../activity/format-relative-time.js";

export interface DashboardFailedRunsProps {
  readonly failedRuns: readonly DashboardFailedRun[];
  readonly isLoading: boolean;
  /** Called when the user clicks "View" on a failed run. */
  readonly onViewClick?: (id: string, type: DashboardFailedRun["type"]) => void;
  readonly className?: string;
}

/**
 * Widget showing recent failed executions from both agent and workflow
 * domains, interleaved by timestamp.
 *
 * Each row includes a type badge (Agent / Workflow), the execution name,
 * a truncated error, and a relative timestamp.
 *
 * @since Unified Platform Dashboard
 */
export const DashboardFailedRuns = memo(function DashboardFailedRuns({
  failedRuns,
  isLoading,
  onViewClick,
  className,
}: DashboardFailedRunsProps) {
  if (isLoading) {
    return (
      <div
        className={cn("stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4", className)}
        aria-busy="true"
      >
        <div className="stg:mb-3 stg:h-4 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="stg:h-10 stg:animate-pulse stg:rounded stg:bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4", className)}>
      <h3 className="stg:mb-3 stg:text-sm stg:font-semibold stg:text-foreground">
        Recent Failures
      </h3>
      {failedRuns.length === 0 ? (
        <p className="stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
          No recent failures
        </p>
      ) : (
        <ul className={cn(UNSTYLED_LIST, "stg:space-y-1.5")} role="list">
          {failedRuns.map((run) => (
            <li
              key={run.id}
              className="stg:flex stg:items-start stg:gap-2 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-xs stg:hover:bg-muted/50"
            >
              <span
                className={cn(
                  "stg:mt-0.5 stg:shrink-0 stg:rounded stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none",
                  run.type === "agent_execution"
                    ? "stg:bg-primary/10 stg:text-primary"
                    : "stg:bg-muted stg:text-muted-foreground",
                )}
              >
                {run.type === "agent_execution" ? "Agent" : "Workflow"}
              </span>
              <div className="stg:min-w-0 stg:flex-1">
                <p className="stg:truncate stg:font-medium stg:text-foreground">
                  {run.name}
                </p>
                {run.error && (
                  <p className="stg:truncate stg:text-muted-foreground">{run.error}</p>
                )}
              </div>
              <span className="stg:shrink-0 stg:text-muted-foreground">
                {formatRelativeTime(run.failedAt)}
              </span>
              {onViewClick && (
                <button
                  type="button"
                  onClick={() => onViewClick(run.id, run.type)}
                  className="stg:shrink-0 stg:text-primary stg:hover:underline"
                >
                  View
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
