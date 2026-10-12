/**
 * The sign-in grant ledger: one row per (account, organization) an
 * identity provider has signed the account in to. The federated lane
 * grants the provider's `sign_in_role` the first time an account signs in
 * to an organization and never again, so a
 * role an admin removes stays removed; the row is how "first" is known.
 *
 * Why claim-then-grant and not one transaction: the grant is an in-process
 * IamPolicy create through the library's grant path, and the row is in
 * this package's own table, so the two cannot share a transaction. Instead
 * the lane claims the row first (`claim`, an insert that answers whether
 * THIS request wrote it), grants only when it won, and releases the row
 * when the grant fails, so the next sign-in tries again. Two concurrent
 * first sign-ins race on the claim and exactly one grants.
 *
 * `recorded` is the read every later request makes (the verifier runs on
 * every request, not only at sign-in): a primary-key read, so the common
 * path writes nothing.
 *
 * An organization's rows go with it: the identity unit's purge stage
 * (iam/organization-delete.ts) removes them with `removeByOrgId`. The
 * ledger is the unit's port, so the unit that writes the rows removes
 * them, whichever host composes it.
 *
 * The host's Postgres adapter is postgres-sign-in-grants.ts beside it.
 */
export interface SignInGrantLedger {
  /** Whether the account has signed in to `org` through an identity provider before. */
  recorded(accountId: string, org: string): Promise<boolean>;
  /** Records the first sign-in; true only for the request that wrote the row. */
  claim(accountId: string, org: string, identityProviderId: string): Promise<boolean>;
  /** Removes a claimed row whose grant failed, so the next sign-in grants again. */
  release(accountId: string, org: string): Promise<void>;
  /** Every account's row for an organization being deleted; answers how many went. Idempotent. */
  removeByOrgId(org: string): Promise<number>;
}
