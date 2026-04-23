import { RunnerListPanel } from "@stigmer/react";
import { useActiveOrgSlug } from "../../org/OrgProvider";

export default function SettingsRunners() {
  const org = useActiveOrgSlug();
  return (
    <div className="h-full overflow-y-auto p-6">
      <RunnerListPanel org={org} />
    </div>
  );
}
