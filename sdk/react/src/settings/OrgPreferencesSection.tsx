"use client";

import { useId } from "react";
import { OrgPreferencesPanel } from "../organization/OrgPreferencesPanel.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Settings section for editing the active organization's declared preferences. */
export function OrgPreferencesSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Organization Preferences
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        Standing context shared with agents on every execution run by this
        organization&apos;s members.
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view its preferences.
        </p>
      ) : (
        <OrgPreferencesPanel orgId={orgId} />
      )}
    </section>
  );
}
