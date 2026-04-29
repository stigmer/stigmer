"use client";

import { OrgMembersPanel } from "../iam-policy/OrgMembersPanel";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice";
import { useOrg } from "../organization/OrgProvider";
import { useIdentityProviderList } from "../identity-provider/useIdentityProviderList";

/** Settings section for organization membership and role management. */
export function MembersSection() {
  const { activeOrg } = useOrg();
  const membersAvailable = useResourceAvailable(ApiResourceKind.iam_policy);
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
    <section aria-labelledby="members-heading">
      <h2
        id="members-heading"
        className="text-foreground mb-1 text-sm font-semibold"
      >
        Members
      </h2>
      <p className="text-muted-foreground mb-4 text-xs">
        Manage who has access to this organization and what they can do.
        Members can be granted owner, admin, member, or viewer roles.
      </p>

      {!membersAvailable ? (
        <CloudFeatureNotice>
          Members management is not available in local mode. IAM policies
          require Stigmer Cloud.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to manage members.
        </p>
      ) : (
        <>
          {hasJitProviders && (
            <div className="mb-3 rounded-md border border-border-muted bg-muted-faint px-3 py-2">
              <p className="text-[0.65rem] text-muted-foreground">
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
