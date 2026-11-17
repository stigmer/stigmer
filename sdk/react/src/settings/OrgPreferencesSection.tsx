"use client";

// The organization's Preferences settings page: the standing context and
// defaults shared with agents on every run its members start, and its
// policies. The panels ask whether the person may change them and draw their
// own data states. Policies were a page of one switch; they are a section
// here, saved as the switch flips.

import { OrgPoliciesPanel } from "../organization/OrgPoliciesPanel.js";
import { OrgPreferencesPanel } from "../organization/OrgPreferencesPanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { Section } from "../resource-detail/Section.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";
import { useOrgDisplayName } from "../organization/useOrgDisplayName.js";

/** Settings section for editing the active organization's declared preferences and its policies. */
export function OrgPreferencesSection() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";
  const orgName = useOrgDisplayName(activeOrg?.metadata?.slug);

  return (
    <SettingsPage
      title="Organization preferences"
      description="What agents know about this organization on every run its members start."
    >
      {!orgId ? (
        <NoOrganization what="its preferences" />
      ) : (
        <div className="stg:flex stg:flex-col stg:gap-4">
          <OrgPreferencesPanel org={orgId} />
          <Section title="Policies">
            <div className="stg:flex stg:flex-col stg:gap-3 stg:p-4">
              <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
                What {orgName}&apos;s members may do. Saves as you switch it.
              </p>
              <OrgPoliciesPanel org={orgId} embedded />
            </div>
          </Section>
        </div>
      )}
    </SettingsPage>
  );
}
