"use client";

// The organization's Preferences settings page: the standing context and
// defaults shared with agents on every run its members start. The panel
// asks whether the person may change them and draws its own data states.

import { OrgPreferencesPanel } from "../organization/OrgPreferencesPanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

/** Settings section for editing the active organization's declared preferences. */
export function OrgPreferencesSection() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <SettingsPage
      title="Organization preferences"
      description="What agents know about this organization on every run its members start."
    >
      {!orgId ? <NoOrganization what="its preferences" /> : <OrgPreferencesPanel org={orgId} />}
    </SettingsPage>
  );
}
