"use client";

import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { useCheckPermission } from "./useCheckPermission.js";

/** What a caller who is not an owner may not assign: owner is assigned by owners. */
const OWNER_ONLY: readonly IamRole[] = [IamRole.owner];
const NOTHING_OMITTED: readonly IamRole[] = [];

/** Return value of {@link useOwnerAssignment}. */
export interface UseOwnerAssignmentReturn {
  /** Whether the caller may grant, revoke or remove the owner role on the organization. */
  readonly canAssignOwner: boolean;
  /**
   * The organization roles to leave out of a role picker for this caller:
   * owner unless they may assign it. A stable list, as `RoleSelector`'s
   * `omitRoles` asks.
   */
  readonly unassignable: readonly IamRole[];
}

/**
 * The console's one reading of the owner rule: the server asks
 * `can_assign_roles` on an organization before any change to its owner
 * role (only its owners hold it), and every surface that offers such a
 * change asks the same question here. Fails open, like every capability
 * gate: the server refuses whatever this lets through.
 *
 * @param orgId - The organization's id, or `null` to skip the check.
 */
export function useOwnerAssignment(orgId: string | null): UseOwnerAssignmentReturn {
  const { allowed } = useCheckPermission(
    orgId ? { kind: "organization", id: orgId } : null,
    "can_assign_roles",
  );
  return {
    canAssignOwner: allowed,
    unassignable: allowed ? NOTHING_OMITTED : OWNER_ONLY,
  };
}
