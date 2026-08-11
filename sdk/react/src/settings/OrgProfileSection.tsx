"use client";

import { useCallback } from "react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrgProfilePanel } from "../organization/OrgProfilePanel.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Settings section for editing the active organization profile. */
export function OrgProfileSection() {
  const { activeOrg, refresh } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  const handleUpdated = useCallback(
    (org: Organization) => {
      refresh(org.metadata?.slug);
    },
    [refresh],
  );

  return (
    <section aria-labelledby="org-profile-heading">
      <h2
        id="org-profile-heading"
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
        <OrgProfilePanel orgId={orgId} onUpdated={handleUpdated} />
      )}
    </section>
  );
}
