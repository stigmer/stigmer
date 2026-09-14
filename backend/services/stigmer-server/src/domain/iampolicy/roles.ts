/**
 * IAM role metadata (20260913.01 slice 5): display metadata for the five
 * assignable roles and the assignable-relation allowlist that keeps
 * structural relations (parent links, runtime grants, observability
 * usersets) out of every access listing BY CONSTRUCTION — reads filter to
 * this set rather than maintaining a denylist a new structural relation
 * could slip past. Moved as-is from the cloud's iam/policy/roles.ts, itself
 * the port of Java's apishape/authorization/IamRoleMetadata; the cloud's
 * `grantableRolesFor` did not come along — it lives in
 * pipeline/apiresource-meta.ts as the contract's one read of
 * `kind_meta.grantable_roles`, and the cloud registers its own reading of
 * it as the `policyGrantScope` driver.
 *
 * The four words this table renders for an organization are the four
 * roles every edition grants there (Q-OR-4) and the ladder entry 3's
 * authorizer enforces; the copy is shown verbatim by the console's role
 * badges and selector, so it is contract.
 */
import { create } from "@bufbuild/protobuf";

import type { RoleInfo } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { RoleInfoSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

/** Display metadata for one assignable role (the Java ROLE_INFO_MAP copy). */
interface RoleDisplay {
  readonly role: IamRole;
  readonly name: string;
  readonly description: string;
}

const ROLE_DISPLAY: ReadonlyArray<RoleDisplay> = [
  {
    role: IamRole.owner,
    name: "Owner",
    description: "Full control of the resource including ownership transfer",
  },
  {
    role: IamRole.admin,
    name: "Administrator",
    description:
      "Administrative access with most permissions except ownership transfer",
  },
  {
    role: IamRole.member,
    name: "Member",
    description: "Read and limited write access to the resource",
  },
  {
    role: IamRole.viewer,
    name: "Viewer",
    description: "Read-only access to the resource",
  },
  // Grantable on agent_channel only (channel-conversations DD-010);
  // omitting it would let the grant succeed while hiding the participant
  // from every access listing (the Java IamRoleMetadataTest lesson).
  {
    role: IamRole.participant,
    name: "Participant",
    description:
      "Reply to customers and manage conversation takeover on a channel",
  },
];

const RELATION_TO_DISPLAY: ReadonlyMap<string, RoleDisplay> = new Map(
  ROLE_DISPLAY.map((entry) => [IamRole[entry.role], entry]),
);

/** The allowlist for access-listing queries (Java assignableRelations). */
export function assignableRelations(): ReadonlyArray<string> {
  return [...RELATION_TO_DISPLAY.keys()];
}

/** True when the relation names an assignable IAM role, never structural. */
export function isAssignableRole(relation: string): boolean {
  return RELATION_TO_DISPLAY.has(relation);
}

/**
 * Relation string → RoleInfo with display metadata; the default instance
 * for unknown relations (the Java fromRelationString contract).
 */
export function roleInfoFromRelation(relation: string): RoleInfo {
  const display = RELATION_TO_DISPLAY.get(relation);
  if (display === undefined) {
    return create(RoleInfoSchema);
  }
  const code = IamRole[display.role];
  return create(RoleInfoSchema, {
    id: code,
    code,
    name: display.name,
    description: display.description,
  });
}
