"use client";

// The organization's dashboard: the week's run figures and its recent
// failures, under the journey's card (`DashboardFirstSteps`) for a host that
// offers it. For an organization where nothing has run yet the card stands
// alone in the figures' place, so a new organization is told what to do
// first instead of being shown four zeros; once something has run it sits
// above the figures until every step is done, then folds to one line.
// "Nothing has run" is asked of all time, not of the week. The card is for a
// person the server lets make agents; a member sees the figures. "Hide"
// removes it for this person in this organization, remembered in this
// browser, and a hidden card makes none of its reads. Figures that could
// not be read are said with a retry, never drawn as zeros, and no
// organization at all is said.

import { memo } from "react";
import { cn } from "@stigmer/design-tokens";
import { useDashboardSummary, type UseDashboardSummaryOptions } from "./useDashboardSummary.js";
import { useDashboardFailedRuns } from "./useDashboardFailedRuns.js";
import { DashboardKPICards } from "./DashboardKPICards.js";
import { DashboardFailedRuns } from "./DashboardFailedRuns.js";
import { DashboardFirstSteps, type DashboardFirstStepLinks, type DashboardFirstStepsProps } from "./DashboardFirstSteps.js";
import { useJourney } from "../journey/useJourney.js";
import { useJourneyHidden } from "../journey/journeyHidden.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";

export interface OperationalDashboardProps {
  /** The organization whose runs and usage the dashboard shows. */
  readonly org: string | null | undefined;
  /** Called with the run's ID when the user clicks "View" on a failed run. */
  readonly onFailedRunClick?: (id: string) => void;
  /**
   * Where the journey's steps lead, as the host routes them. With them, a
   * person who may make agents sees the journey's card: alone, instead of
   * four zeros, while nothing has run here; above the figures after that,
   * until every step is done. Without them, the figures as always.
   */
  readonly firstStepLinks?: DashboardFirstStepLinks;
  /** Draws a first step's link with the host's router; a plain anchor otherwise. */
  readonly renderLink?: DashboardFirstStepsProps["renderLink"];
  readonly className?: string;
}

/**
 * Composed dashboard widget showing an organization's run
 * operational metrics.
 *
 * Layout:
 * - Row 1: KPI stat cards (Active | Completed | Failed | Tokens)
 * - Row 2: Recent Failures
 *
 * For a host that passes `firstStepLinks`, the journey's card
 * ({@link DashboardFirstSteps}) takes both rows' place while nothing has
 * run, and sits above them after that until every step is done.
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
 *       firstStepLinks={{ connectProvider: "/models", createAgent: "/", startSession: "/" }}
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

  const { hidden, hide } = useJourneyHidden(org ?? "");
  const journeyOn = firstStepLinks !== undefined && !!org && !hidden;
  const journey = useJourney(org, { enabled: journeyOn });
  const showsJourney = journeyOn && journey.status === "ready";
  // Laid out on whether anything ran at all, a failed run included: its
  // figures (and its failure) are the organization's to see.
  const nothingEverRan = showsJourney && journey.everRan === false;
  // Until the journey is known, the figures wait as their skeleton, so a new
  // organization never sees zeros flash before its card, and the card never
  // pushes figures already drawn down the page.
  const figuresLoading = summaryLoading || (journeyOn && journey.status === "pending");

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
      {showsJourney && firstStepLinks && (
        <DashboardFirstSteps org={org} links={firstStepLinks} renderLink={renderLink} journey={journey} onHide={hide} />
      )}
      {!nothingEverRan && (
        <>
          {/* Figures that could not be read are not drawn as zeros. */}
          {!summaryError && <DashboardKPICards summary={summary} isLoading={figuresLoading} />}
          <DashboardFailedRuns failedRuns={failedRuns} isLoading={failedLoading} onViewClick={onFailedRunClick} />
        </>
      )}
    </section>
  );
});
