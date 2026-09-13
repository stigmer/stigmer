"use client";

import { useId } from "react";
import { OrgMembersPanel } from "../iam-policy/OrgMembersPanel.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { useOrg } from "../organization/OrgProvider.js";
import { useIdentityProviderList } from "../identity-provider/useIdentityProviderList.js";

/**
 * Settings section for organization membership and role management.
 *
 * Rendered in every edition: the IamPolicy row half — who holds which
 * role on the organization — is served by open source as well as the
 * Enterprise and Cloud editions. What differs is how people ARRIVE: where
 * the edition serves invitations, the Invitations section beside this one
 * is the door; where it does not (open source), people join the
 * organization the first time they sign in and the server records their
 * role, so this section says so.
 */
export function MembersSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const invitationsAvailable = useResourceAvailable(
    ApiResourceKind.invitation,
  );
  const idpAvailable = useResourceAvailable(ApiResourceKind.identity_provider);
  const orgId = activeOrg?.metadata?.id ?? "";
  const orgSlug = activeOrg?.metadata?.slug ?? "";

  const { identityProviders } = useIdentityProviderList(
    idpAvailable && orgSlug ? orgSlug : null,
  );

  const hasJitProviders = identityProviders.some(
    (idp) => idp.spec?.autoProvisionAccounts || idp.spec?.isSsoProvider,
  );

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Members
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Manage who has access to this organization and what they can do.
        Members can be granted owner, admin, member, or viewer roles.
        {!invitationsAvailable && (
          <>
            {" "}
            There are no invitations on this edition: people join this
            organization the first time they sign in, and you adjust their
            roles here.
          </>
        )}
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage members.
        </p>
      ) : (
        <>
          {hasJitProviders && (
            <div className="stg:mb-3 stg:rounded-md stg:border stg:border-border-muted stg:bg-muted-faint stg:px-3 stg:py-2">
              <p className="stg:text-[0.65rem] stg:text-muted-foreground">
                This organization has identity providers with auto-provisioning
                enabled. Members may appear here automatically when users
                authenticate via federated identity.
              </p>
            </div>
          )}
          <OrgMembersPanel orgId={orgId} />
        </>
      )}
    </section>
  );
}
