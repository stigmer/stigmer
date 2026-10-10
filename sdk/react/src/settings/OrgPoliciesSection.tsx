"use client";

/** Settings section for the active organization's policies: what its members may do. */
import { useId } from "react";
import { OrgPoliciesPanel } from "../organization/OrgPoliciesPanel.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Settings section for editing the active organization's policies. */
export function OrgPoliciesSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold">
        Policies
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        What this organization&apos;s members may do.
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view its policies.
        </p>
      ) : (
        <OrgPoliciesPanel org={orgId} />
      )}
    </section>
  );
}
