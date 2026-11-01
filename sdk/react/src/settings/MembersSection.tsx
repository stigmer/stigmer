"use client";

// The Members settings page: who belongs to the active organization and the
// role each holds. The members panel draws the rows and their data states.

import { OrgMembersPanel } from "../grant/OrgMembersPanel.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { useOrg } from "../organization/OrgProvider.js";
import { useFederationIssuerList } from "../federation-issuer/useFederationIssuerList.js";

/** Props for {@link MembersSection}. */
export interface MembersSectionProps {
  /**
   * Where the members list's "Service accounts" group links. Defaults to
   * `/settings/service-accounts`; a host that routes by hash (the desktop
   * app) passes its own spelling.
   */
  readonly serviceAccountsHref?: string;
}

/**
 * Settings section for organization membership and role management.
 *
 * Rendered in every edition: the Grant row half — who holds which
 * role on the organization — is served by open source as well as the
 * Enterprise and Cloud editions. What differs is how people ARRIVE: where
 * the edition serves invitations, the Invitations section beside this one
 * is the door; where it does not (open source), people join the
 * organization the first time they sign in and the server records their
 * role, so this section says so.
 */
export function MembersSection({ serviceAccountsHref }: MembersSectionProps = {}) {
  const { activeOrg } = useOrg();
  const invitationsAvailable = useResourceAvailable(
    ApiResourceKind.invitation,
  );
  const issuerAvailable = useResourceAvailable(ApiResourceKind.federation_issuer);
  const org = activeOrg?.metadata?.id ?? "";

  const { federationIssuers } = useFederationIssuerList(
    issuerAvailable && org ? org : null,
  );

  // An issuer with a sign-in role adds people here on their first
  // sign-in.
  const hasSignInRoleProviders = federationIssuers.some((issuer) =>
    Boolean(issuer.spec?.signInRole),
  );

  return (
    <SettingsPage
      title="Members"
      description={
        <>
          Who belongs to this organization and the role each holds: owner, admin, member or viewer. Only an owner grants or
          removes owner.
          {!invitationsAvailable && (
            <> People join this organization the first time they sign in; you set their roles here.</>
          )}
        </>
      }
    >
      {!org ? (
        <NoOrganization what="its members" />
      ) : (
        <>
          {hasSignInRoleProviders && (
            <p className="stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-faint stg:px-4 stg:py-3 stg:text-xs stg:text-muted-foreground">
              This organization has federation issuers that grant a sign-in role. People appear here the first time they sign
              in through one of them.
            </p>
          )}
          <OrgMembersPanel org={org} serviceAccountsHref={serviceAccountsHref} />
        </>
      )}
    </SettingsPage>
  );
}
