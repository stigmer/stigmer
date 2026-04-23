"use client";

import {
  OrgUsagePanel,
  useDeploymentMode,
  CloudFeatureNotice,
} from "@stigmer/react";
import { useOrg } from "@/domain/_shared/org/org-context";

export function UsageSection() {
  const { activeOrg } = useOrg();
  const mode = useDeploymentMode();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby="usage-heading">
      <h2
        id="usage-heading"
        className="text-foreground mb-1 text-sm font-semibold"
      >
        Usage
      </h2>
      <p className="text-muted-foreground mb-4 text-xs">
        Monitor token consumption, cost, and execution activity across
        your organization.
      </p>

      {mode === "local" ? (
        <CloudFeatureNotice>
          Usage reports are not available in local mode. Connect to Stigmer
          Cloud to view organization-level cost and token analytics.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to view usage.
        </p>
      ) : (
        <OrgUsagePanel orgId={orgId} />
      )}
    </section>
  );
}
