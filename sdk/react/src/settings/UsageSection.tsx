"use client";

import { useId } from "react";
import { OrgUsagePanel } from "../usage/OrgUsagePanel.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Settings section for organization usage and cost reporting. */
export function UsageSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Usage
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Monitor token consumption, cost, and execution activity across
        your organization.
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view usage.
        </p>
      ) : (
        <OrgUsagePanel orgId={orgId} />
      )}
    </section>
  );
}
