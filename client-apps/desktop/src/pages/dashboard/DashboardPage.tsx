/**
 * The dashboard route: the kit's page heading over `OperationalDashboard`,
 * with the app's routes for a new organization's first steps (the models
 * hub, a new agent, the launcher). Wired as the web console's page is;
 * only the link component differs (the router's, so the hash routes hold).
 */

import { useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOrg, OperationalDashboard, PageHeader, type DashboardFirstStepsProps } from "@stigmer/react-sdk";

const FIRST_STEP_LINKS = {
  connectProvider: "/models",
  // The launcher: its first question offers the example jobs.
  createAgent: "/",
  startSession: "/",
} as const;

const renderLink: NonNullable<DashboardFirstStepsProps["renderLink"]> = ({ href, className, children }) => (
  <Link to={href} className={className}>
    {children}
  </Link>
);

export default function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.id ?? "";
  const navigate = useNavigate();

  const handleFailedRunClick = useCallback(
    (id: string) => {
      navigate(`/runs/${id}`);
    },
    [navigate],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        className="mb-8"
        title="Dashboard"
        description="What your organization's agents did this week."
      />

      <OperationalDashboard
        org={org}
        onFailedRunClick={handleFailedRunClick}
        firstStepLinks={FIRST_STEP_LINKS}
        renderLink={renderLink}
      />
    </div>
  );
}
