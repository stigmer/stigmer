"use client";

/**
 * The settings page for credentials, "Accounts and keys": the active
 * organization's {@link CredentialsPanel}, or a prompt to pick an
 * organization when none is active.
 */
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { CredentialsPanel } from "../credential/CredentialsPanel.js";

/** Settings section listing your credentials and, for admins, the organization's. */
export function CredentialsSection() {
  const org = useActiveOrgId();

  if (!org) {
    return (
      <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
        Select an organization to see its accounts and keys.
      </p>
    );
  }

  return <CredentialsPanel org={org} />;
}
