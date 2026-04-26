"use client";

import { InvitationManager } from "../invitation/InvitationManager";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice";
import { useActiveOrgSlug } from "../organization/OrgProvider";

/** Settings section for creating and managing organization invitations. */
export function InvitationsSection() {
  const org = useActiveOrgSlug();
  const invitationsAvailable = useResourceAvailable(ApiResourceKind.invitation);

  return (
    <section aria-labelledby="invitations-heading">
      <div className="mb-3">
        <h2
          id="invitations-heading"
          className="text-foreground text-sm font-semibold"
        >
          Invitations
        </h2>
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Shareable invite links that grant organization membership with a
        configurable role. Create single-use links for specific people or
        multi-use links for public sharing.
      </p>

      {!invitationsAvailable ? (
        <CloudFeatureNotice>
          Invitations are not available in local mode.
        </CloudFeatureNotice>
      ) : !org ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to manage invitations.
        </p>
      ) : (
        <InvitationManager org={org} />
      )}
    </section>
  );
}
