"use client";

// The Usage settings page: the active organization's token usage and run
// activity. The panel draws its own data states.

import { OrgUsagePanel } from "../usage/OrgUsagePanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

/** Settings section for organization token usage reporting. */
export function UsageSection() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <SettingsPage title="Usage" description="Tokens and runs across this organization, by model and by day.">
      {!orgId ? <NoOrganization what="its usage" /> : <OrgUsagePanel org={orgId} />}
    </SettingsPage>
  );
}
