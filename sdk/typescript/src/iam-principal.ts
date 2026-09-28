/**
 * Who an IAM policy grants a role to: a person or a team, in one shape a
 * client builds grants from and reads access lists back into.
 *
 * The wire spells a grantee as an `ApiResourceRef`: a person is
 * `identity_account:<id>` with no relation qualifier, a team is
 * `team:<id>#member` (every member of the team holds the grant). This
 * module is the one place in the SDK that knows that spelling, so no caller
 * writes the qualifier by hand and no caller can drop it.
 *
 * Reading goes through the same module: `granteeFromView` turns an access
 * list entry back into a `Grantee` and answers `undefined` for anything it
 * does not recognise (another kind, a team with a qualifier other than
 * `member`), so a client never acts on a principal it would misname. A
 * revoke built from the returned grantee names the exact row the list
 * showed, because the server's revoke matches the qualifier exactly.
 *
 * `isPlatformClientAccount` reads the other thing a client needs from an
 * entry: whether the person is one the organization's own product brought
 * in through a PlatformClient. Such an account holds a real role on the
 * organization (a client's auto-grant), yet it is a user of that product,
 * not a person of the organization, and the server's own membership rules
 * skip it for that reason. A members view lists and counts the
 * organization's people without these accounts; an access audit still
 * shows everyone who holds a role.
 */
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import {
  type ApiResourceRef,
  ApiResourceRefSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

const PERSON_KIND = ApiResourceKind[ApiResourceKind.identity_account];
const TEAM_KIND = ApiResourceKind[ApiResourceKind.team];

/** The relation that makes every member of a team the grantee. */
const TEAM_MEMBERS_RELATION = "member";

/** A person or a team an IAM policy can grant a role to. */
export type Grantee =
  | { readonly kind: "identity_account"; readonly id: string }
  | { readonly kind: "team"; readonly id: string };

/** The kind of a {@link Grantee}. */
export type GranteeKind = Grantee["kind"];

/** A person, by identity account id (`ida_...`). */
export function personGrantee(id: string): Grantee {
  return { kind: "identity_account", id };
}

/** A team, by team id (`tm_...`). */
export function teamGrantee(id: string): Grantee {
  return { kind: "team", id };
}

/**
 * The `ApiResourceRef` an IAM policy spec names the grantee with: a person
 * unqualified, a team as its members.
 */
export function granteeRef(grantee: Grantee): ApiResourceRef {
  switch (grantee.kind) {
    case "identity_account":
      return create(ApiResourceRefSchema, { kind: PERSON_KIND, id: grantee.id });
    case "team":
      return create(ApiResourceRefSchema, {
        kind: TEAM_KIND,
        id: grantee.id,
        relation: TEAM_MEMBERS_RELATION,
      });
    default: {
      const unreachable: never = grantee;
      return unreachable;
    }
  }
}

/**
 * The grantee an access-list entry names, or `undefined` when the entry
 * is not a person or a team's members (a structural principal, a kind this
 * SDK does not know, or a team qualifier other than `member`).
 */
export function granteeFromView(
  view: Pick<ApiResourceRefView, "kind" | "id" | "relation">,
): Grantee | undefined {
  if (!view.id) return undefined;
  if (view.kind === PERSON_KIND && view.relation === "") {
    return personGrantee(view.id);
  }
  if (view.kind === TEAM_KIND && view.relation === TEAM_MEMBERS_RELATION) {
    return teamGrantee(view.id);
  }
  return undefined;
}

/**
 * Whether an access-list entry is an account a PlatformClient provisioned:
 * a person kind whose identity origin is `platform_client`. An entry the
 * server could not resolve carries no origin and reads `false`.
 */
export function isPlatformClientAccount(
  view: Pick<ApiResourceRefView, "kind" | "identityOrigin">,
): boolean {
  return (
    view.kind === PERSON_KIND &&
    view.identityOrigin?.provisioningMode === IdentityAccountProvisioningMode.platform_client
  );
}

/** A stable key for a grantee: its kind and id. */
export function granteeKey(grantee: Grantee): string {
  return `${grantee.kind}:${grantee.id}`;
}
