"use client";

import { OrgUsagePanel } from "../usage/OrgUsagePanel";
import { useOrg } from "../organization/OrgProvider";

/** Settings section for organization usage and cost reporting. */
export function UsageSection() {
  const { activeOrg } = useOrg();
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

      {!orgId ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to view usage.
        </p>
      ) : (
        <OrgUsagePanel orgId={orgId} />
      )}
    </section>
  );
}
