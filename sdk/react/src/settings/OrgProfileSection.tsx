"use client";

import { useId } from "react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ChildOrganizationsList } from "../organization/ChildOrganizationsList.js";
import { OrgProfilePanel } from "../organization/OrgProfilePanel.js";
import { useOrg } from "../organization/OrgProvider.js";

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
 * Settings section for editing the active organization profile. The panel
 * refreshes the organization context itself after a save or a rename, so
 * the section adds no refresh of its own. Below it, a parent organization's
 * admins see its child organizations, each with an Open action that makes
 * the child the active organization.
 */
export function OrgProfileSection({ onOrgChanged }: OrgProfileSectionProps = {}) {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Organization Profile
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        Manage your organization&apos;s display name, description, and logo.
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view its profile.
        </p>
      ) : (
        <>
          <OrgProfilePanel org={orgId} />
          <ChildOrganizationsList org={orgId} onOrgChanged={onOrgChanged} />
        </>
      )}
    </section>
  );
}
