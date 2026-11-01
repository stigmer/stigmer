"use client";

/**
 * The dashboard route: the kit's page heading over `OperationalDashboard`,
 * with the console's routes for a new organization's first steps (the
 * models hub, a new agent, the launcher). Wired as the desktop app's page
 * is; only the link component differs.
 */

import Link from "next/link";
import { useOrg, OperationalDashboard, PageHeader, type DashboardFirstStepsProps } from "@stigmer/react-sdk";
import { useRunNavigation } from "@/domain/runs/run-navigation";

const FIRST_STEP_LINKS = {
  connectProvider: "/models",
  createAgent: "/library/agents/new",
  startSession: "/",
} as const;

const renderLink: NonNullable<DashboardFirstStepsProps["renderLink"]> = ({ href, className, children }) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

export function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.id ?? "";
  const { navigateToRun } = useRunNavigation();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        className="mb-8"
        title="Dashboard"
        description="What your organization's agents did this week."
      />

      <OperationalDashboard
        org={org}
        onFailedRunClick={navigateToRun}
        firstStepLinks={FIRST_STEP_LINKS}
        renderLink={renderLink}
      />
    </div>
  );
}
