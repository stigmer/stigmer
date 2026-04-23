"use client";

import {
  OrgMembersPanel,
  useResourceAvailable,
  CloudFeatureNotice,
  ApiResourceKind,
} from "@stigmer/react";
import { useOrg } from "@/domain/_shared/org/org-context";

export function MembersSection() {
  const { activeOrg } = useOrg();
  const membersAvailable = useResourceAvailable(ApiResourceKind.iam_policy);
  const orgId = activeOrg?.metadata?.id ?? "";

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
        <OrgMembersPanel orgId={orgId} />
      )}
    </section>
  );
}
