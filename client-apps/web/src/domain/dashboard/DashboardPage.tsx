"use client";

/**
 * The dashboard route: the kit's page heading over `OperationalDashboard`,
 * with the console's routes for the journey's six steps (the launcher, the
 * models hub, the agent page's tabs, the members page). Wired as the
 * desktop app's page is; only the link component differs.
 */

import { useMemo } from "react";
import { useOrg, OperationalDashboard, PageHeader, type DashboardFirstStepLinks } from "@stigmer/react-sdk";
import { PageFrame } from "@stigmer/react-sdk/console";
import { useRunNavigation } from "@/domain/runs/run-navigation";
import { renderJourneyLink, useJourneyLinks } from "@/domain/journey/journey-links";

export function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.id ?? "";
  const { navigateToRun } = useRunNavigation();
  const { makeItYours, putInApp, bringOthers } = useJourneyLinks();
  const firstStepLinks = useMemo<DashboardFirstStepLinks>(
    () => ({
      connectProvider: "/models",
      // The launcher: its first question offers the example jobs.
      createAgent: "/",
      startSession: "/",
      makeItYours,
      putInApp,
      bringOthers,
    }),
    [makeItYours, putInApp, bringOthers],
  );

  return (
    <PageFrame width="wide">
      <PageHeader
        className="mb-8"
        title="Dashboard"
        description="What your organization's agents did this week."
      />

      <OperationalDashboard
        org={org}
        onFailedRunClick={navigateToRun}
        firstStepLinks={firstStepLinks}
        renderLink={renderJourneyLink}
      />
    </PageFrame>
  );
}
