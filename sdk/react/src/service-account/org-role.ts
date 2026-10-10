/**
 * A service account's organization role, read from the organization's access
 * list: the role granted on the organization itself, not one inherited.
 *
 * A service account holds at most one (its create grants it, a change grants
 * the new one before revoking the old), so the first direct grant is its
 * role. An account whose role was removed reads `null` and is still listed,
 * so it can be given one again or deleted. Not exported from the package
 * barrel.
 */
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { iamRoleFromString } from "@stigmer/sdk";

/** The role and its wire code, as the access list spelled it. */
export interface OrgRoleOf {
  readonly role: IamRole;
  /** The code the revoke of this role names, exactly as granted. */
  readonly code: string;
}

/** The account's direct organization role, or `null` when it holds none. */
export function orgRoleOf(
  members: readonly PrincipalAccess[],
  accountId: string,
): OrgRoleOf | null {
  const entry = members.find((member) => member.principal?.id === accountId);
  const code = entry?.roles.find((grant) => !grant.isInherited)?.role?.code ?? "";
  if (code === "") return null;
  const role = iamRoleFromString(code);
  return role === undefined ? null : { role, code };
}
