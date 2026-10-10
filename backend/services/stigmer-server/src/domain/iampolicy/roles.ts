/**
 * IAM role metadata: the display metadata for the seven assignable roles
 * and the assignable-relation allowlist that keeps structural relations
 * (parent links, runtime grants, observability usersets) out of every
 * access listing BY CONSTRUCTION — reads filter to this set rather than
 * maintaining a denylist a new structural relation could slip past. Moved
 * from the cloud's iam/policy/roles.ts, itself the port of Java's
 * apishape/authorization/IamRoleMetadata; `grantableRolesFor` lives in
 * pipeline/apiresource-meta.ts as the contract's one read of
 * `kind_meta.grantable_roles`.
 *
 * The words are the contract's, never a table here: a role's name is its
 * IamRole value's `role_meta.display_name`, and what it means is the
 * sentence the kind that holds the grant states for it
 * (`kind_meta.authorization.role_descriptions`), because Viewer on an agent
 * and Viewer on a conversation allow different things. A role the kind
 * does not describe falls back to `role_meta.description`, the kindless
 * sentence. The console and the SDK read the same proto through generated
 * tables, so the server and every picker say the same words.
 */
import { create, getOption, hasOption } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { RoleInfo } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { RoleInfoSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  IamRole,
  IamRoleSchema,
  role_meta,
} from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { roleDescriptionsFor } from "../../pipeline/apiresource-meta.js";

/**
 * The seven assignable roles, in display order. Every one must be here: a
 * role missing from the allowlist would let a grant succeed while hiding
 * the grantee from every access listing (the Java IamRoleMetadataTest
 * lesson) — participant on a channel or a conversation, editor on a
 * blueprint, user ("Can use") on a vault.
 */
const ASSIGNABLE_ROLES: ReadonlyArray<IamRole> = [
  IamRole.owner,
  IamRole.admin,
  IamRole.member,
  IamRole.viewer,
  IamRole.participant,
  IamRole.editor,
  IamRole.user,
];

const ROLE_BY_RELATION: ReadonlyMap<string, IamRole> = new Map(
  ASSIGNABLE_ROLES.map((role) => [IamRole[role], role]),
);

/** The allowlist for access-listing queries (Java assignableRelations). */
export function assignableRelations(): ReadonlyArray<string> {
  return [...ROLE_BY_RELATION.keys()];
}

/** True when the relation names an assignable IAM role, never structural. */
export function isAssignableRole(relation: string): boolean {
  return ROLE_BY_RELATION.has(relation);
}

/**
 * Each role's `role_meta`: its name and its kindless sentence. Every
 * assignable role carries one (pinned by the contract's own test).
 */
const ROLE_META: ReadonlyMap<IamRole, { readonly name: string; readonly description: string }> =
  new Map(
    IamRoleSchema.values
      .filter((value) => hasOption(value, role_meta))
      .map((value) => {
        const meta = getOption(value, role_meta);
        return [
          value.number as IamRole,
          { name: meta.displayName, description: meta.description },
        ];
      }),
  );

/**
 * Relation string → RoleInfo with display metadata, worded for the kind
 * that holds the grant; the default instance for a relation that is no
 * role (the Java fromRelationString contract).
 */
export function roleInfoFromRelation(
  relation: string,
  kind: ApiResourceKind,
): RoleInfo {
  const role = ROLE_BY_RELATION.get(relation);
  if (role === undefined) {
    return create(RoleInfoSchema);
  }
  const meta = ROLE_META.get(role);
  return create(RoleInfoSchema, {
    id: relation,
    code: relation,
    name: meta?.name ?? "",
    description: roleDescriptionsFor(kind).get(role) ?? meta?.description ?? "",
  });
}
