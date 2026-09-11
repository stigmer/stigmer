/**
 * The IdentityAccountStore PORT (20260911.11, T01_0_plan.md §3a; Q-IA-4):
 * the storage contract the identity-account domain writes and reads
 * through, cut from the cloud's row store (iam/account/store.ts) to its
 * DIRECT subset. This is the first OSS domain whose persistence is a port
 * rather than the generic Store: the cloud serves the same controller
 * over its own `cloud.iam_identity_account` table by registering an
 * implementation as `drivers.identityAccountStore`, so the domain's
 * pipeline steps take this interface, never `Store`. Open source's own
 * implementation is resource-store.ts over the generic Store.
 *
 * What the port deliberately does not carry: the two federation lookups
 * (`findByProviderAndIdpId`, `findByOrgAndSlug`) stay on the cloud's own
 * store behind the IdentityFederation capability — a port does not carry
 * methods only one edition calls.
 *
 * Contract every implementation must satisfy (proven by the port's cases
 * in __tests__/resource-store.test.ts, which the cloud driver runs too):
 *   - `save` is create-only in effect: a save under a held id raises
 *     DuplicateAccountError, never a silent overwrite;
 *   - `findDirectByIdpId` answers only non-federated accounts (the
 *     platform's own subjects) — a customer's federated IdP may mint the
 *     same `auth0|…` shape and the platform lane must never resolve to it;
 *   - `findDirectByEmail` answers direct accounts only: federation
 *     legitimately duplicates emails, so the email axis is non-unique;
 *   - `findByIds` keeps request order and skips unknown ids;
 *   - a typed not-found reads as `undefined`; any other storage failure
 *     propagates as the infrastructure fault it is (the ratified
 *     store-fault mapping — an outage must never read as "no account").
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

/**
 * Raised by `save` when the id is already held, so callers run their own
 * race arms (provisioning resolves the winner by subject; the create RPC
 * answers ALREADY_EXISTS). `cause` carries a driver's own error (the
 * cloud's SQLSTATE 23505) for the logs; the message is the port's.
 */
export class DuplicateAccountError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DuplicateAccountError";
  }
}

export interface IdentityAccountStore {
  /** Insert; a held id raises DuplicateAccountError. */
  save(account: IdentityAccount): Promise<void>;
  /** Full-row replace by id (profile updates, preference writes). */
  update(account: IdentityAccount): Promise<void>;
  /** Removes the row; no error when it does not exist. */
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<IdentityAccount | undefined>;
  /** Any provisioning mode — the getByIdpId RPC's lookup. */
  findByIdpId(idpId: string): Promise<IdentityAccount | undefined>;
  /** Non-federated accounts only — the verifiers' and whoAmI's lookup. */
  findDirectByIdpId(idpId: string): Promise<IdentityAccount | undefined>;
  /** Direct accounts only, exact match — the getByEmail RPC's lookup. */
  findDirectByEmail(email: string): Promise<IdentityAccount | undefined>;
  /** The present ones, in request order; unknown ids are skipped. */
  findByIds(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<IdentityAccount>>;
}
