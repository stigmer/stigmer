"use client";

import { useId } from "react";
import { OrgProfilePanel } from "../organization/OrgProfilePanel.js";
import { useOrg } from "../organization/OrgProvider.js";

/**
 * Settings section for editing the active organization profile. The panel
 * refreshes the organization context itself after a save or a rename, so
 * the section adds no refresh of its own.
 */
export function OrgProfileSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Organization Profile
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        Manage your organization&apos;s display name, description, and logo.
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view its profile.
        </p>
      ) : (
        <OrgProfilePanel org={orgId} />
      )}
    </section>
  );
}
