"use client";

/**
 * useCanManageOrgCredentials: whether the caller may save credentials that
 * belong to the organization (`can_create_org_credential`, an admin's).
 *
 * Asked fail-closed: the owner choice and the organization's section are
 * offered only once the server has said yes, so a member never sees a
 * choice the server would refuse. The org may be named by id or slug; the
 * check is asked of its id, which is how permissions are recorded.
 */
import { useMemo } from "react";
import { findOrgByRef, useOptionalOrg } from "../organization/OrgProvider.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";

/** Return value of {@link useCanManageOrgCredentials}. */
export interface UseCanManageOrgCredentialsReturn {
  /** `true` once the server has confirmed the caller may save the organization's credentials. */
  readonly allowed: boolean;
  /** `true` while the check is in flight. */
  readonly isLoading: boolean;
}

/**
 * Behaviour hook answering whether the caller administers the
 * organization's credentials. Pass `null` to skip (answers `false`).
 *
 * @example
 * ```tsx
 * const { allowed } = useCanManageOrgCredentials(org);
 * ```
 */
export function useCanManageOrgCredentials(
  org: string | null,
): UseCanManageOrgCredentialsReturn {
  const orgs = useOptionalOrg()?.orgs;
  const orgId = useMemo(() => {
    if (!org) return "";
    return (orgs ? findOrgByRef(orgs, org)?.metadata?.id : undefined) || org;
  }, [orgs, org]);
  const { allowed, isLoading } = useCheckPermission(
    orgId ? { kind: "organization", id: orgId } : null,
    "can_create_org_credential",
    { fail: "closed" },
  );
  return useMemo(
    () => ({ allowed: orgId !== "" && allowed, isLoading }),
    [orgId, allowed, isLoading],
  );
}
