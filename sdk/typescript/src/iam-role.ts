import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

const ROLE_STRINGS: Record<IamRole, string> = {
  [IamRole.iam_role_unspecified]: "unspecified",
  [IamRole.owner]: "owner",
  [IamRole.admin]: "admin",
  [IamRole.member]: "member",
  [IamRole.viewer]: "viewer",
  [IamRole.participant]: "participant",
};

const STRING_TO_ROLE: Record<string, IamRole> = {
  owner: IamRole.owner,
  admin: IamRole.admin,
  member: IamRole.member,
  viewer: IamRole.viewer,
  participant: IamRole.participant,
};

const ROLE_DISPLAY_NAMES: Record<IamRole, string> = {
  [IamRole.iam_role_unspecified]: "Unspecified",
  [IamRole.owner]: "Owner",
  [IamRole.admin]: "Admin",
  [IamRole.member]: "Member",
  [IamRole.viewer]: "Viewer",
  [IamRole.participant]: "Participant",
};

const ROLE_DESCRIPTIONS: Record<IamRole, string> = {
  [IamRole.iam_role_unspecified]: "",
  [IamRole.owner]: "Full access including delete and access management",
  [IamRole.admin]: "Edit access and member management",
  [IamRole.member]: "Standard access to organization resources",
  [IamRole.viewer]: "Read-only access",
  [IamRole.participant]: "Reply to customers and manage conversation takeover",
};

/**
 * Converts an IamRole enum value to its FGA relation string.
 *
 * This is the string used in `IamPolicySpec.relation` when creating
 * or deleting IAM policies.
 *
 * @example iamRoleToString(IamRole.admin) // "admin"
 */
export function iamRoleToString(role: IamRole): string {
  return ROLE_STRINGS[role] ?? "unspecified";
}

/**
 * Parses an FGA relation string to an IamRole enum value.
 *
 * Returns `undefined` for unrecognized strings.
 *
 * @example iamRoleFromString("admin") // IamRole.admin
 */
export function iamRoleFromString(s: string): IamRole | undefined {
  return STRING_TO_ROLE[s];
}

/**
 * Human-readable display name for an IamRole.
 *
 * @example iamRoleDisplayName(IamRole.admin) // "Admin"
 */
export function iamRoleDisplayName(role: IamRole): string {
  return ROLE_DISPLAY_NAMES[role] ?? "Unknown";
}

/**
 * Short description of what the role grants.
 *
 * Suitable for tooltips and helper text in role selectors.
 *
 * @example iamRoleDescription(IamRole.viewer) // "Read-only access"
 */
export function iamRoleDescription(role: IamRole): string {
  return ROLE_DESCRIPTIONS[role] ?? "";
}
