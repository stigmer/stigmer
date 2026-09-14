/**
 * The policy-grant-scope driver point (20260913.01; the P1 gate's Q7 iii,
 * T01_1_review.md Q-OR-3): WHICH kinds a user may grant a role on in this
 * edition, and with which roles. Single instance, registered as
 * `drivers.policyGrantScope` (the identityFederation shape: a driver point
 * whose absence is open source's own behaviour). Absent, the composition
 * root installs `newOrganizationOnlyGrantScope()`
 * (domain/iampolicy/grant-scope.ts): the organization grants the roles its
 * `kind_meta` lists — owner, admin, member, viewer (Q-OR-4) — and no other
 * kind grants anything. Per-resource grants (a viewer on one agent) are
 * what the Enterprise and Cloud editions add by registering a wider scope;
 * the cloud registers every kind's `kind_meta` roles.
 *
 * Who reads it: the IamPolicy command controller's ValidateGrantableRole on
 * `create` — AFTER the proto (`grantableRolesFor` in
 * pipeline/apiresource-meta.ts, the source of "what can be granted at
 * all"; a kind that lists no roles is system-managed in every edition and
 * refused before the scope is asked) and never on `bootstrapPolicy`, the
 * structural lane — and `checkMyPermission`'s second arm, which answers
 * `can_grant_access` false for a kind outside the scope so the console's
 * existing PermissionGate hides grant controls without a new SDK surface
 * (Q-OR-5).
 *
 * The contract every scope is held to (Q-S3-3, 2026-09-13):
 *
 *   - It NARROWS the proto, never widens it. A scope's answer for a kind is
 *     read as a subset of `kind_meta.authorization.grantable_roles`;
 *     ValidateGrantableRole intersects the two, so a driver cannot admit a
 *     role the contract does not list by accident.
 *   - It is TOTAL over ApiResourceKind, the unknown kind included: a kind
 *     it does not admit answers the empty list, never a throw.
 *     checkMyPermission asks about a kind that came off the wire and was
 *     resolved by `kindByEnumName`, which yields the unknown kind rather
 *     than failing (apiresource-meta.ts header).
 *   - It is SYNCHRONOUS: an edition's grant scope is a fact about the
 *     edition, a proto read at most, never I/O. A scope that would need a
 *     network to answer is a different seam.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

/** The grant-scope contract (single-instance point, ExtensionDrivers.policyGrantScope). */
export interface PolicyGrantScope {
  /**
   * The roles a user may grant on a resource of `kind` in this edition — a
   * subset of the kind's proto `grantable_roles`; empty when the edition
   * grants nothing on the kind (or the kind is unknown). Never throws.
   */
  grantableRoles(kind: ApiResourceKind): ReadonlyArray<IamRole>;
}
