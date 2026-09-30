/**
 * What the grant path says about a change to a policy row: who made it,
 * through which door, and in which organization. The grant path
 * (grant-path.ts) builds one for every row it writes or deletes that
 * grants access, and hands it to the store beside the row
 * (`IamPolicyStore.save` and `deleteById`), so an edition that keeps a
 * permission history writes it in the same atomic unit as the row. Open
 * source keeps no history table; the same facts ride the path's grant and
 * revoke log lines.
 *
 * The cause names a door the grant path already has, never an edition's
 * business reason: an edition that grants on a person's behalf (an
 * invitation, a federated sign-in) says whom it acted for through the
 * actor (`serverActingFor`, pipeline/interceptors/auth.ts), not through a
 * cause of its own. The strings are stored bytes in an edition's history:
 * a cause is added, never renamed or reused.
 *
 * An access row is a row that lets someone reach something: it names a
 * person, or an audience written as a userset (`team:T#member`,
 * `organization:O#viewer`, `identity_provider:I#platform_user`). A row
 * naming a resource as its principal with no relation is a structural link
 * (a parent, a default instance, a managed organization), the bookkeeping
 * a resource's own creation implies; it carries no change record.
 *
 * The actor is the caller's id and class and nothing else: never the email,
 * the display name or the token, so a history holds no more of a person
 * than the rows it describes already do.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { CallerClass, CallerIdentity } from "../../extensions/identity.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";

/**
 * The door a change came through. Stored bytes in an edition's history.
 *
 *   - `grant`: IamPolicy.create, a grant on the user lane.
 *   - `revoke`: IamPolicy.delete.
 *   - `structural`: IamPolicy.bootstrapPolicy, the server recording what a
 *     resource's creation or visibility implies (its creator's authorship,
 *     its audience).
 *   - `organization_access_revoked`: revokeOrgAccess and its system twin,
 *     a person removed from an organization.
 *   - `left_organization`: the sweep that follows a person's last role on
 *     an organization, revoking what they held on its resources.
 *   - `resource_deleted`: the rows that die with a deleted resource
 *     (cleanupResourcePolicies, the built-in lifecycle's delete cleanup,
 *     an organization's revoke before its row goes).
 *   - `organization_created`: open source's creator `owner` row.
 *   - `first_sign_in`: open source's membership rules for a new account.
 *   - `role_reconciliation`: the one-shot pass that gives existing
 *     accounts the roles the membership rules would have.
 *   - `operator_ownership`: the trusted-local operator made owner of an
 *     organization nobody owns.
 *   - `platform_client_grant`: a PlatformClient's auto-granted role on the
 *     account it mints.
 */
export type PolicyChangeCause =
  | "grant"
  | "revoke"
  | "structural"
  | "organization_access_revoked"
  | "left_organization"
  | "resource_deleted"
  | "organization_created"
  | "first_sign_in"
  | "role_reconciliation"
  | "operator_ownership"
  | "platform_client_grant";

/** Who made a change: the caller's id and class, nothing that identifies a person beyond the id. */
export interface PolicyActor {
  readonly id: string;
  readonly callerClass: CallerClass;
}

/**
 * What the store is handed beside an access row it writes or deletes. An
 * implementation that keeps a history records exactly one entry for it, in
 * the same atomic unit as the row change, and none when the row did not
 * change (IamPolicyStore, store.ts).
 */
export interface PolicyChangeRecord {
  readonly actor: PolicyActor;
  readonly cause: PolicyChangeCause;
  /**
   * The organization the row's resource belongs to, resolved before any
   * row of the operation is deleted; "" when none can be found (a kind
   * outside organization scope, a legacy row with no scope link).
   */
  readonly organizationId: string;
}

const ACCOUNT_KIND = kindEnumName(ApiResourceKind.identity_account);

/** The actor a caller is recorded as. */
export function policyActorOf(caller: CallerIdentity): PolicyActor {
  return { id: caller.identityId, callerClass: caller.callerClass };
}

/** Whether a row lets someone reach something (a person or an audience), as opposed to a structural link. */
export function grantsAccess(spec: IamPolicySpec): boolean {
  const principal = spec.principal;
  if (principal === undefined) {
    return false;
  }
  return principal.kind === ACCOUNT_KIND || principal.relation !== "";
}
