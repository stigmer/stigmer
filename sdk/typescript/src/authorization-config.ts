/**
 * Which roles a caller may grant on a resource kind, read from the
 * proto-generated authorization config, so a client offers exactly the
 * grants the server's `ValidateGrantableRole` step accepts.
 *
 * Two grantees, two tables: a person may be granted any role in
 * `GRANTABLE_ROLES`; a team (Enterprise and Cloud) only the roles in
 * `TEAM_GRANTABLE_ROLES`, always a subset of the person's. Each table has
 * the same three readers, so a caller asks the team question with the
 * same shape it asks the person one.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import {
  GRANTABLE_ROLES,
  TEAM_GRANTABLE_ROLES,
} from "./gen/authorization-config.js";

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

/**
 * Returns the roles a team may be granted on the given resource kind.
 *
 * An empty array means the kind cannot be shared with a team. Whether the
 * connected edition serves teams at all is a separate question, answered
 * by `isResourceAvailable(ApiResourceKind.team, mode)`.
 */
export function getTeamGrantableRoles(
  kind: ApiResourceKind,
): readonly IamRole[] {
  return TEAM_GRANTABLE_ROLES.get(kind) ?? EMPTY_ROLES;
}

/**
 * Whether the given resource kind can be shared with a team at all.
 */
export function hasTeamGrantableRoles(kind: ApiResourceKind): boolean {
  const roles = TEAM_GRANTABLE_ROLES.get(kind);
  return roles !== undefined && roles.length > 0;
}

/**
 * Whether a team may be granted the given role on the given resource kind
 * — the team arm of the backend's `ValidateGrantableRole` step.
 */
export function isRoleTeamGrantable(
  kind: ApiResourceKind,
  role: IamRole,
): boolean {
  const roles = TEAM_GRANTABLE_ROLES.get(kind);
  return roles !== undefined && roles.includes(role);
}
