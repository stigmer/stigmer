"use client";

import { memo } from "react";
import { EmptyState } from "../empty-state/EmptyState.js";
import { Card, cardHeaderClasses } from "../internal/surface/Card.js";
import { List, ListRow } from "../internal/surface/List.js";
import type { DashboardFailedRun } from "./types.js";
import { formatRelativeTime } from "../activity/format-relative-time.js";

export interface DashboardFailedRunsProps {
  readonly failedRuns: readonly DashboardFailedRun[];
  readonly isLoading: boolean;
  /** Called when the user clicks "View" on a failed run. */
  readonly onViewClick?: (id: string) => void;
  readonly className?: string;
}

/**
 * Widget showing recent failed runs, newest first.
 *
 * Each row includes the run name, a truncated error, and a relative
 * timestamp.
 */
export const DashboardFailedRuns = memo(function DashboardFailedRuns({
  failedRuns,
  isLoading,
  onViewClick,
  className,
}: DashboardFailedRunsProps) {
  if (isLoading) {
    return (
      <Card className={className} aria-busy="true">
        <div className="stg:mb-3 stg:h-4 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="stg:h-10 stg:animate-pulse stg:rounded stg:bg-muted" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card flush className={className}>
      <div className={cardHeaderClasses()}>
        <h3 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">
          Recent Failures
        </h3>
      </div>
      {failedRuns.length === 0 ? (
        <EmptyState variant="first-use" size="inline" title="No recent failures" description="" />
      ) : (
        <List bare>
          {failedRuns.map((run) => (
            <ListRow
              key={run.id}
              name={run.name}
              description={run.error || undefined}
              trailing={
                <>
                  <span className="stg:text-xs stg:text-muted-foreground">
                    {formatRelativeTime(run.failedAt)}
                  </span>
                  {onViewClick && (
                    <button
                      type="button"
                      onClick={() => onViewClick(run.id)}
                      className="stg:text-xs stg:text-primary stg:hover:underline"
                    >
                      View
                    </button>
                  )}
                </>
              }
            />
          ))}
        </List>
      )}
    </Card>
  );
});
