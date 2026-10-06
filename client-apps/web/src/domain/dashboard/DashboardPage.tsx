"use client";

import { useOrg, OperationalDashboard } from "@stigmer/react";
import { useRunNavigation } from "@/domain/runs/run-navigation";

export function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.id ?? "";
  const { navigateToRun } = useRunNavigation();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational overview across your organization.
        </p>
      </div>

      <OperationalDashboard org={org} onFailedRunClick={navigateToRun} />
    </div>
  );
}
