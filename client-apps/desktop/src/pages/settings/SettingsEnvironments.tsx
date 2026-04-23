import { EnvironmentListPanel } from "@stigmer/react";
import { useActiveOrgSlug } from "../../org/OrgProvider";

export default function SettingsEnvironments() {
  const org = useActiveOrgSlug();
  return (
    <div className="h-full overflow-y-auto p-6">
      <EnvironmentListPanel org={org} />
    </div>
  );
}
