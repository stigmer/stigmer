/**
 * The IamPolicy specs server code builds ITSELF, spelled once
 * (20260913.01 slice 4). A wire caller hands the domain a spec; the
 * built-in role lifecycle, the membership rules and slice 5's
 * `revokeOrgAccess` and contextual `checkMyPermission` build their own.
 * The derived policy id hashes the spec's exact text (constants.ts
 * `policyIdFor`), so two spellings of one triple would be two rows — this
 * module is where "identity_account:<id> holds <role> on
 * organization:<org>" has one spelling in production code, the way the
 * test support's `orgRole` is that spelling for tests.
 *
 * Kinds are spelled through `kindEnumName` (the ApiResourceRef vocabulary,
 * pipeline/apiresource-meta.ts); relations are the `IamRole` member names,
 * which are the FGA model's relation names and the proto's grantable-role
 * vocabulary. The zero value `iam_role_unspecified` is not a relation and
 * is refused (the `accountIdFor("")` precedent): hashing it would mint a
 * real row for a role nobody holds.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamPolicySpecSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";

/** The relation string a role grants — the enum member's own name. */
export function relationOf(role: IamRole): string {
  if (role === IamRole.iam_role_unspecified) {
    throw new Error("iam_role_unspecified is not a relation");
  }
  return IamRole[role];
}

/** `identity_account:<accountId>` holds `<role>` on `organization:<organizationId>` — the organization role. */
export function organizationRole(
  accountId: string,
  role: IamRole,
  organizationId: string,
): IamPolicySpec {
  return create(IamPolicySpecSchema, {
    principal: {
      kind: kindEnumName(ApiResourceKind.identity_account),
      id: accountId,
    },
    relation: relationOf(role),
    resource: {
      kind: kindEnumName(ApiResourceKind.organization),
      id: organizationId,
    },
  });
}
