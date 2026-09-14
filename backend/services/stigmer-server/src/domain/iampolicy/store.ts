/**
 * The IamPolicyStore PORT (20260913.01, T01_0_plan.md §3a; Q-OR-1): the
 * storage contract the IamPolicy domain writes and reads through, cut from
 * the cloud's row store (iam/policy/store.ts) to what BOTH editions call.
 * The second OSS domain whose persistence is a port rather than the
 * generic Store (the identity account was the first): the cloud serves the
 * same controller over its own `cloud.iam_policy` table by registering an
 * implementation as `drivers.iamPolicyStore`, so the domain's grant path
 * and handlers take this interface, never `Store`. Open source's own
 * implementation is resource-store.ts over the generic Store.
 *
 * What the port deliberately does not carry: `markSynced` and
 * `findUnsynced` (the cloud's tuple-mirror bookkeeping and boot backfill;
 * its store keeps them as extras) and `findByIdentityAccountInOrg` (the
 * cloud's org-column arm of revocation — the column was never stamped by
 * any writer, so it matched nothing; dropped, Q-OR-9). A port does not
 * carry methods only one edition calls or no edition needs.
 *
 * Contract every implementation must satisfy — proven by the port-contract
 * kit (store-contract.ts, exported), which the OSS adapter's test iterates
 * on both drivers and a composition's driver test iterates too:
 *   - `save` is create-only in effect: a save under a held ID raises
 *     DuplicatePolicyError, never a silent overwrite. Under derived ids a
 *     held triple IS a held id, which is what the kit exercises; where a
 *     composition still holds legacy random ids, "one row per triple" is
 *     the grant path's by-triple read (grant-path.ts), not this promise;
 *   - `deleteById` of an unknown id resolves;
 *   - the finds answer rows by the axes named, exactly:
 *     `findByPrincipalAndResource` every relation on the pair;
 *     `findByResourceWithRelations` the allowlist only, an empty allowlist
 *     matching nothing; `countDistinctPrincipalsByResource` distinct
 *     (kind, id) principals — not rows — over the allowlist, `undefined`
 *     principal kind meaning any (callers normalize the wire's `""`);
 *     `findScopeTuple` the resource's one structural link — a principal
 *     that is not `identity_account` or `team` and a relation that is not
 *     `owner` or `creator`, the cloud SQL's exclusion arms verbatim (`team`
 *     is a Java-era name no ApiResourceKind carries; kept so the two
 *     editions' filters read alike);
 *   - a typed not-found reads as `undefined`; any other storage failure
 *     propagates as the infrastructure fault it is (the ratified
 *     store-fault mapping — an outage must never read as "no grant").
 */
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

/**
 * Raised by `save` when the id is already held, so the grant path runs its
 * race arm (re-read the winner by triple; answer it as the duplicate).
 * `cause` carries a driver's own error (the cloud's SQLSTATE 23505) for
 * the logs; the message is the port's.
 */
export class DuplicatePolicyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DuplicatePolicyError";
  }
}

export interface IamPolicyStore {
  /** Insert; a held id raises DuplicatePolicyError. */
  save(policy: IamPolicy): Promise<void>;
  /** Removes the row; no error when it does not exist. */
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<IamPolicy | undefined>;
  /** Every row naming the principal — the cleanup's principal-side arm. */
  findByPrincipal(
    principalKind: string,
    principalId: string,
  ): Promise<ReadonlyArray<IamPolicy>>;
  /** Every row on the resource — the cleanup's resource-side arm. */
  findByResource(
    resourceKind: string,
    resourceId: string,
  ): Promise<ReadonlyArray<IamPolicy>>;
  /** Every relation the principal holds on the resource — the by-triple read's candidates. */
  findByPrincipalAndResource(
    principalKind: string,
    principalId: string,
    resourceKind: string,
    resourceId: string,
  ): Promise<ReadonlyArray<IamPolicy>>;
  /** Rows on the resource whose relation is in the allowlist (the assignable roles); an empty allowlist matches nothing. */
  findByResourceWithRelations(
    resourceKind: string,
    resourceId: string,
    relations: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<IamPolicy>>;
  /** Distinct (kind, id) principals holding an allowlisted relation on the resource; `undefined` kind = any. */
  countDistinctPrincipalsByResource(
    resourceKind: string,
    resourceId: string,
    principalKind: string | undefined,
    relations: ReadonlyArray<string>,
  ): Promise<number>;
  /**
   * The resource's scope tuple (the hierarchy walk's one step): a policy
   * on the resource whose principal is structural (not identity_account
   * or team) and whose relation is structural (not owner or creator).
   */
  findScopeTuple(
    resourceKind: string,
    resourceId: string,
  ): Promise<IamPolicy | undefined>;
}
