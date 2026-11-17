"use client";

// The dashboard's recent failures: a card with its header bar ("Recent
// failures" and how many), one row per failed run newest first (its name,
// the failure's own line, when, and a quiet View), the kit's inline empty
// line when nothing failed, and, on the page in the card's place, the
// failure said with Try again when the failures could not be read. A read
// that failed is never drawn as "No recent failures": that is the one card
// whose job is to say something went wrong (stigmer#3235). While the first
// read is on its way the card keeps its shape: its header, three rows'
// outlines.

import { memo } from "react";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Section } from "../resource-detail/Section.js";
import type { DashboardFailedRun } from "./types.js";
import { formatRelativeTime } from "../activity/format-relative-time.js";

export interface DashboardFailedRunsProps {
  readonly failedRuns: readonly DashboardFailedRun[];
  readonly isLoading: boolean;
  /** Why the failures could not be read; the card says it instead of "No recent failures". */
  readonly error?: Error | null;
  /** Reads the failures again; the failed read offers Try again with it. */
  readonly onRetry?: () => void;
  /** Called when the user clicks "View" on a failed run. */
  readonly onViewClick?: (id: string) => void;
  readonly className?: string;
}

/** The card's title, which also names its region. */
const TITLE = "Recent failures";

/**
 * Widget showing recent failed runs, newest first.
 *
 * Each row includes the run name, its failure's line, a relative timestamp
 * and, for a host that routes runs, a View act. A read that failed says so,
 * with Try again for a host that passes `onRetry`.
 */
export const DashboardFailedRuns = memo(function DashboardFailedRuns({
  failedRuns,
  isLoading,
  error = null,
  onRetry,
  onViewClick,
  className,
}: DashboardFailedRunsProps) {
  if (isLoading) {
    return (
      <Section title={TITLE} className={className}>
        <LoadingRegion label="Loading recent failures">
          <ul className="stg:m-0 stg:list-none stg:divide-y stg:divide-border-muted stg:p-0" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="stg:flex stg:min-h-10 stg:items-center stg:gap-3 stg:px-3.5 stg:py-2.5">
                <span className="stg:flex stg:flex-1 stg:flex-col stg:gap-2">
                  <span className="stg:h-3.5 stg:w-2/5 stg:animate-pulse stg:rounded stg:bg-muted" />
                  <span className="stg:h-3 stg:w-3/5 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
                </span>
                <span className="stg:h-3 stg:w-8 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
              </li>
            ))}
          </ul>
        </LoadingRegion>
      </Section>
    );
  }

  // Said on the page, as the figures' failure is: the failed tint inside a
  // card would put its muted line under the contrast floor in dark.
  if (error) {
    return (
      <ErrorMessage
        error={error}
        title="Couldn't load recent failures."
        comfort="This week's figures above are unaffected."
        retry={onRetry}
        className={className}
      />
    );
  }

  return (
    <Section title={TITLE} count={failedRuns.length} className={className}>
      {failedRuns.length === 0 ? (
        <EmptyState variant="first-use" size="inline" title="No recent failures." description="" />
      ) : (
        <List bare>
          {failedRuns.map((run) => (
            <ListRow
              key={run.id}
              name={run.name}
              description={run.error || undefined}
              trailing={
                <>
                  <span className="stg:text-xs stg:text-muted-foreground">{formatRelativeTime(run.failedAt)}</span>
                  {onViewClick && (
                    <Button variant="ghost" size="xs" onClick={() => onViewClick(run.id)}>
                      View
                    </Button>
                  )}
                </>
              }
            />
          ))}
        </List>
      )}
    </Section>
  );
});
