"use client";

import { EmptyState } from "../empty-state/index.js";
import type { SettingsPageDenial } from "../settings/SettingsPage.js";

/** What the licenses console says to a person who is not a platform operator. */
export const LICENSES_DENIAL: SettingsPageDenial = {
  title: "Platform operator access required",
  description:
    "Licenses are issued by Stigmer's platform operators and carry customer contracts and signed keys. Organization roles do not grant access; if you need it, ask a platform operator to grant you the platform operator role.",
};

/**
 * The access-denied state for the licenses operator surface.
 * Server-side authorization (`can_issue_license` on `platform:stigmer`)
 * is the real gate; this is the designed face of that denial for anyone
 * who reaches the route without the permission, instead of a raw RPC
 * error string.
 */
export function LicensesAccessNotice({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <EmptyState
      variant="permission"
      className={className}
      title={LICENSES_DENIAL.title}
      description={LICENSES_DENIAL.description}
    />
  );
}
