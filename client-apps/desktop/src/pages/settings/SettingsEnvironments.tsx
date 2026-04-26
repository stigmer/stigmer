import { EnvironmentListPanel, useActiveOrgSlug } from "@stigmer/react";

export default function SettingsEnvironments() {
  const org = useActiveOrgSlug();
  return (
    <div className="h-full overflow-y-auto p-6">
      <EnvironmentListPanel org={org} />
    </div>
  );
}
