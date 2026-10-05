/**
 * The deleting rule: an organization being deleted does not exist.
 *
 * Deleting an organization marks it in the deletion table
 * (`Store.organizationDeletions`) before anything irreversible happens, and
 * the purge removes the mark last, after everything the organization owned
 * is gone (purge/runner.ts). Between the two, every way in answers exactly
 * what it answers for an organization that was never there. There are
 * three ways in, so there are three seats, and this module owns the
 * predicate all three ask:
 *
 *   1. A request that names an organization, in any field the contract
 *      spells as one (`organizationValuesOf`, the organization-name
 *      resolver's own rule): `createDeletingOrganizationInterceptor`, on
 *      the serving chain and the in-process chain alike. The in-process
 *      lane skips the Authorizer, and server code starts work through it
 *      (a schedule's fire, a channel's message, a workflow's step), so a
 *      rule that lived only at the decision seat would let work start
 *      inside an organization being deleted.
 *   2. A decision about a row that already exists, by id: the credential
 *      binding's target resolution (authorization/credential-binding.ts)
 *      reads the target's `metadata.org` and answers not-found when that
 *      organization is being deleted, whatever the caller, so a
 *      per-resource owner row that the delete's revocation leaves cannot
 *      reach the row; the list read scope and the organization directory
 *      leave such rows and organizations out.
 *   3. The walks over every organization: the membership rules, the
 *      organization limit, the child list and the directory-less
 *      organization list read `deletingIds` and skip them.
 *
 * A by-id call from server code (a runner's status write) names no
 * organization and skips the Authorizer, so it is not refused: it cannot
 * start anything new, and the purge ends what it serves.
 *
 * The purge itself is the one caller the interceptor admits: a request on
 * the in-process lane whose caller is the purge's own actor
 * (`PURGE_ACTOR`, an `internal` caller only the in-process chain can mint,
 * so no wire request can present it). A composition's lifecycle or stage
 * removes what it keeps through in-process RPCs that name the
 * organization (its policy cleanup, for one), acting for the purge.
 *
 * Cost. `isDeleting` is one primary-key read, memoised per request scope
 * (the caller identity the chain stamps once per request), so a request
 * naming one organization pays one read whichever seats ask.
 * `deletingIds` reads the whole table, which holds only the organizations
 * whose purge has not finished.
 *
 * What the tests pin (__tests__/lifecycle.test.ts): the memo, the
 * interceptor's refusal copy on both chains, and a request naming no
 * organization reading nothing.
 */
import type { Interceptor } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { getKindName } from "../../pipeline/apiresource-meta.js";
import { notFoundError } from "../../pipeline/errors.js";
import { callerIdentityKey } from "../../pipeline/interceptors/auth.js";
import { organizationValuesOf } from "../../pipeline/interceptors/organization-names.js";
import type { OrganizationDeletionStore } from "../../store/interface.js";

/** The principal the purge acts for (purge/runner.ts): the deletion itself. */
export const PURGE_ACTOR = "organization-purge";

/** The predicate every seat asks. */
export interface OrganizationLifecycle {
  /**
   * Whether `org` is being deleted. Memoised for the life of `scope` (the
   * request's caller identity); an undefined scope reads every time.
   */
  isDeleting(scope: object | undefined, org: string): Promise<boolean>;
  /** Every organization being deleted, for a walk over many organizations. */
  deletingIds(): Promise<ReadonlySet<string>>;
}

/** A lifecycle with no deletion table: nothing is ever deleting (a test's composition). */
export const NOTHING_DELETING: OrganizationLifecycle = {
  isDeleting: () => Promise.resolve(false),
  deletingIds: () => Promise.resolve(new Set()),
};

export function newOrganizationLifecycle(
  deletions: Pick<OrganizationDeletionStore, "isDeleting" | "list">,
): OrganizationLifecycle {
  const memo = new WeakMap<object, Map<string, Promise<boolean>>>();
  return {
    isDeleting(scope, org) {
      if (org === "") {
        return Promise.resolve(false);
      }
      if (scope === undefined) {
        return deletions.isDeleting(org);
      }
      let held = memo.get(scope);
      if (held === undefined) {
        held = new Map();
        memo.set(scope, held);
      }
      const known = held.get(org);
      if (known !== undefined) {
        return known;
      }
      const reading = deletions.isDeleting(org);
      held.set(org, reading);
      // A failed read is not remembered: the next seat asks again.
      reading.catch(() => held.delete(org));
      return reading;
    },
    async deletingIds() {
      return new Set((await deletions.list()).map((row) => row.org));
    },
  };
}

/**
 * Seat 1: refuses a request that names an organization being deleted with
 * the copy a missing organization gets from the Authorize step
 * (`Organization not found: <id>`), so the two cannot be told apart.
 * Streams pass: a stream request carries no message to read here, and every
 * stream this server serves names a row by id (seat 2).
 */
export function createDeletingOrganizationInterceptor(
  lifecycle: OrganizationLifecycle,
): Interceptor {
  const kindName = getKindName(ApiResourceKind.organization);
  return (next) => async (request) => {
    if (request.stream) {
      return next(request);
    }
    const values = organizationValuesOf(request.method, request.message);
    if (values.length === 0) {
      return next(request);
    }
    const scope = request.contextValues.get(callerIdentityKey);
    if (
      scope?.callerClass === "internal" &&
      scope.identityId === PURGE_ACTOR
    ) {
      return next(request);
    }
    for (const org of new Set(values)) {
      if (await lifecycle.isDeleting(scope, org)) {
        throw notFoundError(kindName, org);
      }
    }
    return next(request);
  };
}
