"use client";

import { useCallback } from "react";
import { OrgProfilePanel, useOrg } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

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
        className="text-foreground mb-1 text-sm font-semibold"
      >
        Organization Profile
      </h2>
      <p className="text-muted-foreground mb-6 text-xs">
        Manage your organization&apos;s display name, description, and logo.
      </p>

      {!orgId ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to view its profile.
        </p>
      ) : (
        <OrgProfilePanel orgId={orgId} onUpdated={handleUpdated} />
      )}
    </section>
  );
}
