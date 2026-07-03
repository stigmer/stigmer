import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { GRANTABLE_ROLES } from "./gen/authorization-config.js";

const EMPTY_ROLES: readonly IamRole[] = Object.freeze([]);

/**
 * Returns the roles that can be granted on the given resource kind
 * via IAM policies.
 *
 * An empty array means no user-grantable roles exist — the resource is
 * either owner-only, inherits authorization from a parent, is self-owned,
 * or has no authorization.
 */
export function getGrantableRoles(
  kind: ApiResourceKind,
): readonly IamRole[] {
  return GRANTABLE_ROLES.get(kind) ?? EMPTY_ROLES;
}

/**
 * Whether the given resource kind has at least one user-grantable role.
 */
export function hasGrantableRoles(kind: ApiResourceKind): boolean {
  const roles = GRANTABLE_ROLES.get(kind);
  return roles !== undefined && roles.length > 0;
}

/**
 * Whether the given role can be granted on the given resource kind.
 *
 * Use this for client-side pre-validation before calling
 * `iamPolicy.create()` — it mirrors the backend's
 * `ValidateGrantableRole` step.
 */
export function isRoleGrantable(
  kind: ApiResourceKind,
  role: IamRole,
): boolean {
  const roles = GRANTABLE_ROLES.get(kind);
  return roles !== undefined && roles.includes(role);
}
