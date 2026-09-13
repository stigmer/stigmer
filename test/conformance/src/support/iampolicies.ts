// Constants and fixtures for the IamPolicy domain (20260913.01 — the row
// half served ONCE by @stigmer/server in every edition).
// Domain: conformance support.
//
// The byte-pinned copy below is the cloud handlers' wording (iam/policy/
// handlers.ts as it read at stigmer-cloud cee0058e9), moved into
// @stigmer/server as-is, plus the two edition sentences the OSS controller
// answers where a capability is not composed. The conformance suite
// deliberately never imports the server's constants — the literal IS the
// contract a client may match on.
//
// A policy spec is a triple: `principal` holds `relation` on `resource`,
// each side an ApiResourceRef the wire names by kind string and id. The
// builders below spell that vocabulary once so every arm reads as the
// grant it makes.
import { create } from "@bufbuild/protobuf";

import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

export const IAM_POLICY_API_VERSION = "iam.stigmer.ai/v1";
export const IAM_POLICY_KIND = "IamPolicy";

// The four kind_meta roles of the organization, in the proto's order — the
// one role set open source grants on (T01_1_review.md Q-OR-4).
export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

// get for an unknown id (the Java copy, kept by the cloud's handler).
export function policyNotFoundMessage(id: string): string {
  return `IAM policy not found: ${id}`;
}

// create on a kind whose kind_meta lists no grantable roles — system-managed
// in EVERY edition, so this sentence rides no capability flag.
export function noGrantableRolesMessage(kindName: string): string {
  return `No roles can be granted on resource kind '${kindName}'. Role assignments for this resource kind are system-managed.`;
}

// create with a role the kind admits nowhere in its kind_meta list.
export function roleNotGrantableMessage(
  relation: string,
  kindName: string,
  grantable: ReadonlyArray<string>,
): string {
  return `Role '${relation}' cannot be granted on resource kind '${kindName}'. Grantable roles: [${grantable.join(", ")}]`;
}

// create on a kind the composed grant scope excludes (open source: anything
// but the organization) — the edition sentence, never INVALID_ARGUMENT.
export const PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE =
  "per-resource access grants are served by the Enterprise and Cloud editions";

// The tuple-half queries with no engine composed — the edition sentence,
// never INTERNAL. The controller may prefix the RPC name, so suites assert
// containment.
export const AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE =
  "authorization queries are served by the Enterprise and Cloud editions";

// checkMyPermission with a relation that is no IamPermission name.
export function unknownPermissionMessage(relation: string): string {
  return `unknown permission '${relation}'`;
}

// The three system RPCs' annotation copy (command.proto error_msg), the
// sentence a wire user hears in every edition (Q-OR-7).
export const BOOTSTRAP_POLICY_DENIED_MESSAGE =
  "unauthorized to bootstrap policy - can_bootstrap_iam permission required";
export const CLEANUP_RESOURCE_POLICIES_DENIED_MESSAGE =
  "unauthorized to cleanup resource policies - can_bootstrap_iam permission required";
export const BOOTSTRAP_REVOKE_ORG_ACCESS_DENIED_MESSAGE =
  "unauthorized to revoke organization access - can_bootstrap_iam permission required";

// An identity-account id no account holds: the principal of the shared grant
// arms. Q-OR-14 rules that neither edition checks a principal's existence
// (OpenFGA references by string; the public-viewer wildcard has no row), so
// granting to it is a real, ruled behaviour on every target and needs no
// second real caller. Unique per call so no run meets another's rows.
export function syntheticAccountId(): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `ida_${stamp.padEnd(26, "0").slice(0, 26)}`;
}

// `identity_account:<accountId>` holds `<role>` on `organization:<orgId>` —
// the organization role, the Members page's grant. The resource id is the
// organization's ID, which for this one kind equals its slug.
export function organizationRole(
  accountId: string,
  role: string,
  organizationId: string,
): IamPolicySpec {
  return policyTriple({ kind: "identity_account", id: accountId }, role, {
    kind: "organization",
    id: organizationId,
  });
}

// Any triple, spelled out — for grants on other kinds (the scope arms) and
// structural relations (the system-RPC arms).
export function policyTriple(
  principal: { kind: string; id: string; relation?: string },
  relation: string,
  resource: { kind: string; id: string },
): IamPolicySpec {
  return create(IamPolicySpecSchema, {
    principal: create(ApiResourceRefSchema, {
      kind: principal.kind,
      id: principal.id,
      relation: principal.relation ?? "",
    }),
    relation,
    resource: create(ApiResourceRefSchema, resource),
  });
}

// A bare reference for the query RPCs that take one.
export function ref(kind: string, id: string) {
  return create(ApiResourceRefSchema, { kind, id });
}
