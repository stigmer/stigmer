"use client";

// The Policies settings page: what the active organization lets its
// members do. The panel asks whether the person may change them and draws
// its own data states.

import { OrgPoliciesPanel } from "../organization/OrgPoliciesPanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

/** Settings section for editing the active organization's policies. */
export function OrgPoliciesSection() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <SettingsPage title="Policies" description="What this organization's members may do. A change applies at once.">
      {!orgId ? <NoOrganization what="its policies" /> : <OrgPoliciesPanel org={orgId} />}
    </SettingsPage>
  );
}
