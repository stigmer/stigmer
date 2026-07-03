"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { DashboardFailedRun } from "./types.js";

export interface DashboardFailedRunsProps {
  readonly failedRuns: readonly DashboardFailedRun[];
  readonly isLoading: boolean;
  /** Called when the user clicks "View" on a failed run. */
  readonly onViewClick?: (id: string, type: DashboardFailedRun["type"]) => void;
  readonly className?: string;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
        className={cn("rounded-lg border border-border bg-card p-4", className)}
        aria-busy="true"
      >
        <div className="mb-3 h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Recent Failures
      </h3>
      {failedRuns.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No recent failures
        </p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {failedRuns.map((run) => (
            <li
              key={run.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                  run.type === "agent_execution"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {run.type === "agent_execution" ? "Agent" : "Workflow"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {run.name}
                </p>
                {run.error && (
                  <p className="truncate text-muted-foreground">{run.error}</p>
                )}
              </div>
              <span className="shrink-0 text-muted-foreground">
                {timeAgo(run.failedAt)}
              </span>
              {onViewClick && (
                <button
                  type="button"
                  onClick={() => onViewClick(run.id, run.type)}
                  className="shrink-0 text-primary hover:underline"
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
