/**
 * The built-in role lifecycle (20260913.01, T01_0_plan.md §3a; T01_1_review.md
 * Q-OR-6a): the ResourceAuthorizationLifecycle open source installs when
 * no unit registers one, under the built-in authorization posture
 * (boot/compose.ts `builtInAuthorization`). It is the ROW writer of that
 * posture at the resource lifecycle points — the one arm that makes an
 * organization's creator its owner without an administrator — and nothing
 * more. The cloud's tuple driver plays the same part for tuples; a
 * composition that registers one never sees this object.
 *
 * It is handed to the ORGANIZATION and IDENTITY-ACCOUNT controllers only
 * (slice 4 ruling Q-S4-8), the two kinds whose events it reads. A
 * lifecycle on a controller turns on the tuple steps' full event
 * resolution for that kind, and resolution fails a request whose
 * configured parent id is missing — Java parity the cloud relies on, and
 * a state open source admits by contract for other kinds (a memory
 * captured with no credential has no subject). Every other controller
 * keeps the composed driver (undefined in open source) and its steps
 * no-op before any resolution, byte-identical to before this entry.
 *
 * What it writes:
 *   - `organization` created with DIRECT attribution (the kind's
 *     owner_type in kind_meta — the event says so; the driver follows it
 *     exactly as the cloud's does) by a `user`-class caller that RESOLVES
 *     to an account: one `owner` row for that account. Only `organization`,
 *     because that row is what the Members page and entry 3's admin rule
 *     read; an owner row on an agent would be the per-resource grant the
 *     grant scope keeps Enterprise (Q-OR-3).
 *   - `organization` and `identity_account` deleted: every row naming the
 *     resource on either side goes, through the grant path's bidirectional
 *     cleanup — the delete chains' CleanupIamPolicies step calls this, so
 *     the rows die with the resource.
 *
 * Who the row is FOR, and who it says wrote it. The event's caller is the
 * position-1 identity, which is an account id only when a verifier
 * resolved it: under the trusted-local posture it is the operator's
 * EMAIL (or "system"), and a composition verifier may stamp a raw
 * subject. `accountForCaller` (domain/identityaccount/resolve.ts) is the
 * domain's one statement of "the caller's account" — the two reads
 * whoAmI makes — so this object and whoAmI cannot disagree (Q-S4-1). The
 * row is then granted AS the account (`identityId` re-stamped, the
 * `provisionMyAccount` idiom), so every policy row's `created_by.id` is
 * an account id — never an email, never an idp subject. A caller that
 * resolves to no account (an idp-shaped subject before provisioning)
 * writes nothing: the membership rules heal a real person's ownership at
 * first provisioning through the organization's creator stamp
 * (membership.ts, Q-OR-6b), so the guard loses nobody. Non-`user` classes
 * (`internal`, `runner`, a composition's own) write nothing by rule — the
 * roles are people's (Q-OR-6b), and under trusted-local a daemon-origin
 * caller carries the operator's fields and would otherwise resolve.
 *
 * Acyclic by construction: this object sits ON TOP of the grant path and
 * defines neither policy hook. The grant path's own lifecycle is the
 * composed driver (undefined in open source), never this object (S1
 * finding B); the test pins both facts.
 *
 * Faults propagate. The create arm's throw fails the organization create
 * (the step maps it INTERNAL; the row survives, a retry converges through
 * the grant path's duplicate arm); the delete arm's throw is logged and
 * the delete succeeds (the step's best-effort contract).
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
} from "../../extensions/resource-authorization.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { accountForCaller } from "../identityaccount/resolve.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import type { IamPolicyGrantPath } from "./grant-path.js";
import { organizationRole } from "./specs.js";

export interface BuiltInRoleLifecycleDeps {
  readonly grantPath: IamPolicyGrantPath;
  readonly accounts: AccountsByCaller;
}

/** The kinds whose rows die with the resource — the two sides an organization role names. */
const CLEANUP_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.organization,
  ApiResourceKind.identity_account,
]);

export function newBuiltInRoleLifecycle(
  deps: BuiltInRoleLifecycleDeps,
): ResourceAuthorizationLifecycle {
  const { grantPath, accounts } = deps;
  return {
    async onResourceCreated(event: ResourceCreatedEvent): Promise<void> {
      if (
        event.kind !== ApiResourceKind.organization ||
        event.ownerAttribution !== OwnerAttributionType.DIRECT ||
        event.caller.callerClass !== "user"
      ) {
        return;
      }
      const account = await accountForCaller(accounts, event.caller);
      const accountId = account?.metadata?.id ?? "";
      if (accountId === "") {
        return;
      }
      await grantPath.grant(
        organizationRole(accountId, IamRole.owner, event.resourceId),
        { ...event.caller, identityId: accountId },
      );
    },

    async onResourceDeleted(event: ResourceDeletedEvent): Promise<void> {
      if (!CLEANUP_KINDS.has(event.kind)) {
        return;
      }
      await grantPath.cleanupResource(
        create(ApiResourceRefSchema, {
          kind: kindEnumName(event.kind),
          id: event.resourceId,
        }),
      );
    },

    async onVisibilityChanged(): Promise<void> {
      // Visibility is a tuple concern (org-viewer, public-viewer shapes);
      // open source's rows record roles, not visibility.
    },
  };
}
