import { OrgMembersPanel, useOrganization } from "@stigmer/react";
import { useActiveOrgSlug } from "../../org/OrgProvider";

export default function SettingsMembers() {
  const orgSlug = useActiveOrgSlug();
  const { organization } = useOrganization(orgSlug);
  const orgId = organization?.metadata?.id ?? "";

  if (!orgId) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <OrgMembersPanel orgId={orgId} />
    </div>
  );
}
