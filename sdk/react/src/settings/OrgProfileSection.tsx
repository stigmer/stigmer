"use client";

/**
 * The organization's Profile settings page: its name, description and
 * logo, and below them, for a parent organization's admins, its child
 * organizations. The panel refreshes the organization context itself after
 * a save or a rename, so the section adds no refresh of its own.
 */
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ChildOrganizationsList } from "../organization/ChildOrganizationsList.js";
import { OrgProfilePanel } from "../organization/OrgProfilePanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

/** Props for {@link OrgProfileSection}. */
export interface OrgProfileSectionProps {
  /**
   * Called when the user opens one of the organization's children from its
   * Child organizations list, after the child has become the active
   * organization. Fires only on the user's act, as `OrgSwitcher`'s callback
   * of the same name does; hosts navigate with it (to the dashboard, as on
   * a switch). Without it the page stays and renders as the child's.
   */
  readonly onOrgChanged?: (org: Organization) => void;
}

/**
 * Settings section for editing the active organization profile. Below it,
 * a parent organization's admins see its child organizations, each with an
 * Open action that makes the child the active organization.
 */
export function OrgProfileSection({ onOrgChanged }: OrgProfileSectionProps = {}) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <SettingsPage title="Organization profile" description="This organization's name, description and logo, as its members see them.">
      {!orgId ? (
        <NoOrganization what="its profile" />
      ) : (
        <>
          <OrgProfilePanel org={orgId} />
          <ChildOrganizationsList org={orgId} onOrgChanged={onOrgChanged} />
        </>
      )}
    </SettingsPage>
  );
}
