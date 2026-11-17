"use client";

// The Policies settings page, for a host that mounts it alone: what the
// active organization lets its members do. The console draws the same
// switch as a section of Organization preferences. The panel asks whether
// the person may change it and draws its own data states.

import { OrgPoliciesPanel } from "../organization/OrgPoliciesPanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { Section } from "../resource-detail/Section.js";
import { SettingsPage } from "./SettingsPage.js";

/** Settings section for editing the active organization's policies. */
export function OrgPoliciesSection() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <SettingsPage title="Policies" description="What this organization's members may do. A change applies at once.">
      {!orgId ? (
        <NoOrganization what="its policies" />
      ) : (
        <Section title="Who may create agents">
          <div className="stg:p-4">
            <OrgPoliciesPanel org={orgId} />
          </div>
        </Section>
      )}
    </SettingsPage>
  );
}
