/**
 * The dashboard route: the kit's page heading over `OperationalDashboard`,
 * with the app's routes for the journey's six steps (the launcher, the
 * models hub, the agent page's tabs, the members page). Wired as the web
 * console's page is; only the link component differs (the router's, so the
 * hash routes hold).
 */

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useOrg, OperationalDashboard, PageHeader, type DashboardFirstStepLinks } from "@stigmer/react-sdk";
import { PageFrame } from "@stigmer/react-sdk/console";
import { renderJourneyLink, useJourneyLinks } from "../../journey/journey-links";

export default function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.id ?? "";
  const navigate = useNavigate();
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

  const handleFailedRunClick = useCallback(
    (id: string) => {
      navigate(`/runs/${id}`);
    },
    [navigate],
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
        onFailedRunClick={handleFailedRunClick}
        firstStepLinks={firstStepLinks}
        renderLink={renderJourneyLink}
      />
    </PageFrame>
  );
}
