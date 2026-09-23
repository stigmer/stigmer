"use client";

import { EmptyState } from "../empty-state/index.js";

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
      title="Platform operator access required"
      description="Licenses are issued by Stigmer's platform operators and carry customer contracts and signed keys. Organization roles do not grant access; if you need it, ask a platform operator to grant you the platform operator role."
    />
  );
}
