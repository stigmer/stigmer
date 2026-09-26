"use client";

import { useId } from "react";
import { InvitationManager } from "../invitation/InvitationManager.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Shown in place of the manager to a caller who may not manage invitations. */
const INVITATIONS_MANAGED_BY_ADMINS =
  "Invitations are managed by your organization's admins.";

/**
 * Settings section for creating and managing organization invitations.
 *
 * An organization's invitations are administered by its admins: the
 * server lists them to, and creates them for, callers who hold
 * `can_grant_access` on the organization. The manager is offered once the
 * server confirms the caller holds it; everyone else is told that the
 * organization's admins manage invitations, rather than shown an empty
 * list and a create button the server would refuse.
 */
export function InvitationsSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const invitationsAvailable = useResourceAvailable(ApiResourceKind.invitation);
  const orgSlug = activeOrg?.metadata?.slug ?? "";
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3">
        <h2
          id={headingId}
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
      ) : !orgSlug ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage invitations.
        </p>
      ) : (
        <PermissionGate
          resource={{ kind: "organization", id: orgId }}
          relation="can_grant_access"
          fallback={
            <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
              {INVITATIONS_MANAGED_BY_ADMINS}
            </p>
          }
        >
          <InvitationManager org={orgSlug} />
        </PermissionGate>
      )}
    </section>
  );
}
