"use client";

import { InvitationManager } from "../invitation/InvitationManager.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";

/** Settings section for creating and managing organization invitations. */
export function InvitationsSection() {
  const org = useActiveOrgSlug();
  const invitationsAvailable = useResourceAvailable(ApiResourceKind.invitation);

  return (
    <section aria-labelledby="invitations-heading">
      <div className="stg:mb-3">
        <h2
          id="invitations-heading"
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          Invitations
        </h2>
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Shareable invite links that grant organization membership with a
        configurable role. Create single-use links for specific people or
        multi-use links for public sharing.
      </p>

      {!invitationsAvailable ? (
        <CloudFeatureNotice>
          Invitations are not available in local mode.
        </CloudFeatureNotice>
      ) : !org ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage invitations.
        </p>
      ) : (
        <InvitationManager org={org} />
      )}
    </section>
  );
}
