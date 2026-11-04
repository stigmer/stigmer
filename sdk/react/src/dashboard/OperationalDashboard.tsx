"use client";

// The organization's dashboard: the week's run figures and its recent
// failures, or, for an organization where nothing has run yet, its first
// steps alone in the figures' place, so a new organization is told what to
// do first instead of being shown four zeros. "Nothing has run" is asked of
// all time, not of the week: a quiet week in an organization that ran
// before still shows its figures. Figures that could not be read are said
// with a retry, never drawn as zeros, and no organization at all is said.

import { memo } from "react";
import { cn } from "@stigmer/design-tokens";
import { useDashboardSummary, type UseDashboardSummaryOptions } from "./useDashboardSummary.js";
import { useDashboardFailedRuns } from "./useDashboardFailedRuns.js";
import { RunSummaryTimeWindow, useRunSummary } from "./useRunSummary.js";
import { DashboardKPICards } from "./DashboardKPICards.js";
import { DashboardFailedRuns } from "./DashboardFailedRuns.js";
import { DashboardFirstSteps, type DashboardFirstStepLinks, type DashboardFirstStepsProps } from "./DashboardFirstSteps.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import type { DashboardSummary } from "./types.js";

export interface OperationalDashboardProps {
  /** The organization whose runs and usage the dashboard shows. */
  readonly org: string | null | undefined;
  /** Called with the run's ID when the user clicks "View" on a failed run. */
  readonly onFailedRunClick?: (id: string) => void;
  /**
   * Where a new organization's first steps lead, as the host routes them.
   * With them, an organization where nothing has run yet sees its first
   * steps alone instead of four zeros; without them, the figures as always.
   */
  readonly firstStepLinks?: DashboardFirstStepLinks;
  /** Draws a first step's link with the host's router; a plain anchor otherwise. */
  readonly renderLink?: DashboardFirstStepsProps["renderLink"];
  readonly className?: string;
}

/** Whether the week's figures show nothing at all: no run active, finished or failed. */
function quietWeek(summary: DashboardSummary | null): boolean {
  return summary !== null && summary.activeCount === 0 && summary.completedCount === 0 && summary.failedCount === 0;
}

/**
 * Composed dashboard widget showing an organization's run
 * operational metrics.
 *
 * Layout:
 * - Row 1: KPI stat cards (Active | Completed | Failed | Tokens)
 * - Row 2: Recent Failures
 *
 * For an organization where no run has ever been made, and a host that
 * passes `firstStepLinks`, the first steps ({@link DashboardFirstSteps})
 * take both rows' place until something has run.
 *
 * Tokens come from the org usage report (`getOrgUsageReport`), which
 * counts each run once, so the dashboard matches the Usage page.
 *
 * @example
 * ```tsx
 * function Home({ onOpen }: { onOpen: (href: string) => void }) {
 *   return (
 *     <OperationalDashboard
 *       org="acme"
 *       onFailedRunClick={(id) => onOpen(`/runs/${id}`)}
 *       firstStepLinks={{ connectProvider: "/models", createAgent: "/library/agents/new", startSession: "/" }}
 *     />
 *   );
 * }
 * ```
 */
export const OperationalDashboard = memo(function OperationalDashboard({
  org,
  onFailedRunClick,
  firstStepLinks,
  renderLink,
  className,
}: OperationalDashboardProps) {
  const summaryOptions: UseDashboardSummaryOptions = {
    org,
    refetchInterval: 60_000,
  };
  const { summary, isLoading: summaryLoading, error: summaryError, refetch } = useDashboardSummary(summaryOptions);

  const { failedRuns, isLoading: failedLoading } = useDashboardFailedRuns(org);

  // Only a quiet week, for a host that offers first steps, asks whether
  // anything has ever run here: a busy organization pays no extra read.
  const asksEver = firstStepLinks !== undefined && summaryError === null && quietWeek(summary);
  const ever = useRunSummary({ org: asksEver ? org : null, timeWindow: RunSummaryTimeWindow.ALL_TIME });
  const everCount = ever.summary
    ? ever.summary.activeCount + Object.values(ever.summary.phaseCounts).reduce((sum, n) => sum + n, 0)
    : null;
  const nothingEverRan = asksEver && ever.error === null && everCount === 0;
  // Until that answer is in, the figures wait as their skeleton, so a new
  // organization never sees zeros flash before its first steps. "Not in"
  // includes the render in which the quiet week first arrives, before the
  // all-time read has started (its hook does not report loading yet).
  const everPending = asksEver && ever.summary === null && ever.error === null;
  const figuresLoading = summaryLoading || everPending;

  if (!org) {
    return (
      <section aria-label="Platform dashboard" className={className}>
        <EmptyState
          variant="first-use"
          title="No organization selected"
          description="Choose an organization to see what its agents did this week."
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Platform dashboard"
      className={cn("stg:space-y-6", className)}
    >
      {summaryError && <ErrorMessage error={summaryError} title="The week's figures could not be read" retry={refetch} />}
      {nothingEverRan && firstStepLinks ? (
        <DashboardFirstSteps org={org} links={firstStepLinks} renderLink={renderLink} />
      ) : (
        <>
          {/* Figures that could not be read are not drawn as zeros. */}
          {!summaryError && <DashboardKPICards summary={summary} isLoading={figuresLoading} />}
          <DashboardFailedRuns failedRuns={failedRuns} isLoading={failedLoading} onViewClick={onFailedRunClick} />
        </>
      )}
    </section>
  );
});
