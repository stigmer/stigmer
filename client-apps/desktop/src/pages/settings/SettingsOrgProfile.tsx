import { OrgProfilePanel, useOrganization, useActiveOrgSlug } from "@stigmer/react";

export default function SettingsOrgProfile() {
  const orgSlug = useActiveOrgSlug();
  const { organization } = useOrganization(orgSlug);
  const orgId = organization?.metadata?.id ?? "";

  if (!orgId) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <OrgProfilePanel orgId={orgId} />
    </div>
  );
}
