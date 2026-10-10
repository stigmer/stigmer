/**
 * IamRole helpers: the relation strings a grant carries, and the words a
 * person reads for a role. Every word is read from the generated tables
 * (enum.proto's role_meta, and each kind's role_descriptions in
 * api_resource_kind.proto), so the console says what the server's access
 * lists say.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  ROLE_DESCRIPTIONS,
  ROLE_DISPLAY_NAMES,
  ROLE_KINDLESS_DESCRIPTIONS,
} from "./gen/authorization-config.js";

const ROLE_STRINGS: Record<IamRole, string> = {
  [IamRole.iam_role_unspecified]: "unspecified",
  [IamRole.owner]: "owner",
  [IamRole.admin]: "admin",
  [IamRole.member]: "member",
  [IamRole.viewer]: "viewer",
  [IamRole.participant]: "participant",
  [IamRole.editor]: "editor",
  [IamRole.user]: "user",
};

const STRING_TO_ROLE: Record<string, IamRole> = {
  owner: IamRole.owner,
  admin: IamRole.admin,
  member: IamRole.member,
  viewer: IamRole.viewer,
  participant: IamRole.participant,
  editor: IamRole.editor,
  user: IamRole.user,
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
  if (role === IamRole.iam_role_unspecified) return "Unspecified";
  return ROLE_DISPLAY_NAMES.get(role) ?? "Unknown";
}

/**
 * What a role means when no resource kind is known.
 *
 * @deprecated A role means different things on different kinds (a Viewer
 * runs an agent but only reads a conversation). Use
 * `grantableRoleDescription(kind, role)`, which returns the kind's own
 * sentence.
 *
 * @example iamRoleDescription(IamRole.viewer) // "Read it; cannot change it"
 */
export function iamRoleDescription(role: IamRole): string {
  return ROLE_KINDLESS_DESCRIPTIONS.get(role) ?? "";
}

/**
 * What a role means on one resource kind, in the words a person picking
 * the role reads: what it lets them do there, and the nearest thing it
 * does not.
 *
 * Returns the kindless sentence for a role the kind does not grant, and an
 * empty string for an unknown role.
 *
 * @example
 * grantableRoleDescription(ApiResourceKind.session, IamRole.viewer)
 * // "Read the conversation; cannot send messages"
 */
export function grantableRoleDescription(
  kind: ApiResourceKind,
  role: IamRole,
): string {
  return (
    ROLE_DESCRIPTIONS.get(kind)?.get(role) ??
    ROLE_KINDLESS_DESCRIPTIONS.get(role) ??
    ""
  );
}
