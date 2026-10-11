/**
 * The IdentityAccountStore PORT:
 * the storage contract the identity-account domain writes and reads
 * through, cut from the cloud's row store (iam/account/store.ts) to its
 * DIRECT subset. This is the first OSS domain whose persistence is a port
 * rather than the generic Store: the cloud serves the same controller
 * over its own `cloud.iam_identity_account` table by registering an
 * implementation as `drivers.identityAccountStore`, so the domain's
 * pipeline steps take this interface, never `Store`. Open source's own
 * implementation is resource-store.ts over the generic Store.
 *
 * The two federated reads (`findByProviderAndIdpId`, `findByProvider`)
 * joined the port when a second edition came to call them: the Enterprise
 * edition serves identity providers over this port as the cloud does over
 * its own table, and a read two editions make belongs on the port. A port
 * still carries no method only one edition calls.
 *
 * Contract every implementation must satisfy — proven by the port-contract
 * kit (store-contract.ts, exported), which the OSS adapter's test iterates
 * on both drivers and a composition's driver test iterates too:
 *   - `save` is create-only in effect: a save under a held id raises
 *     DuplicateAccountError, never a silent overwrite; a direct account
 *     with an empty `idp_id` is refused, since no lookup could reach it;
 *   - `update` replaces, never creates: an unknown id writes nothing;
 *   - an account carries an identity_provider_ref if and only if its mode
 *     is `federated`, and `save` and `update` refuse either mixed shape.
 *     It is what "federated" means to every lookup below: while it holds,
 *     a driver may classify a row by either field and agree with every
 *     other driver. A ref under another mode split a person's sign-in
 *     (stigmer#1190), and mode `federated` without a ref is a provider's
 *     subject that a driver keyed on the ref would answer as a platform
 *     person's.
 *     A row with neither (direct, platform-client, a composition's
 *     system account) is unaffected;
 *   - `deleteById` of an unknown id resolves;
 *   - `findDirectByIdpId` answers only the platform's own subjects —
 *     never a federated account (a customer's federated IdP may mint the
 *     same `auth0|…` shape and the platform lane must never resolve to it)
 *     never a platform-client end user (its subject is the mint's), and
 *     never an organization's service account (it signs in through
 *     nothing, so no sign-in's subject may resolve to it);
 *   - `findDirectByEmail` answers direct accounts only, by exact match:
 *     federation legitimately duplicates emails, so the email axis is
 *     non-unique, and a platform-client account's email is one its
 *     platform asserted, so no email lookup may answer it, nor a service
 *     account's;
 *   - `findByIds` answers one row per distinct id, in first-occurrence
 *     order, and skips unknown ids;
 *   - `findByProviderAndIdpId` answers only a federated account, by the
 *     identity provider that vouches for it and its subject: never one
 *     under another provider (two providers may assert one subject for two
 *     people) and never a direct account sharing the subject (the
 *     federated lane must never resolve a platform person);
 *   - `findByProvider` answers every federated account the provider
 *     vouches for, in id order, and nothing of another provider's or any
 *     direct row;
 *   - a typed not-found reads as `undefined`; any other storage failure
 *     propagates as the infrastructure fault it is (the store-fault
 *     mapping — an outage must never read as "no account").
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
  /** Insert; a held id raises DuplicateAccountError; a direct account with no idp_id, or a mixed shape, is refused. */
  save(account: IdentityAccount): Promise<void>;
  /** Full-row replace by id (profile updates, preference writes); an unknown id writes nothing; a mixed shape is refused. */
  update(account: IdentityAccount): Promise<void>;
  /** Removes the row; no error when it does not exist. */
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<IdentityAccount | undefined>;
  /**
   * The account under a subject in any mode but federated — the getByIdpId
   * RPC's lookup and the platform-client mint's. A federated subject is its
   * identity provider's to choose, so it is reached only through the
   * federated natural key (provider and subject), never by a bare subject.
   */
  findByIdpId(idpId: string): Promise<IdentityAccount | undefined>;
  /** The platform's own subjects only (no federated, no platform-client, no service account) — the verifiers' and whoAmI's lookup. */
  findDirectByIdpId(idpId: string): Promise<IdentityAccount | undefined>;
  /** Direct accounts only, exact match — the getByEmail RPC's lookup. */
  findDirectByEmail(email: string): Promise<IdentityAccount | undefined>;
  /** The present ones, once per distinct id, in first-occurrence order; unknown ids are skipped. */
  findByIds(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<IdentityAccount>>;
  /**
   * The federated account the identity provider `<providerOrg>/<providerSlug>`
   * vouches for under `idpId` — the federated sign-in's lookup, and the
   * natural key a federated account is reached by. `providerOrg` is the
   * provider's organization id, as the stored reference holds it.
   */
  findByProviderAndIdpId(
    providerOrg: string,
    providerSlug: string,
    idpId: string,
  ): Promise<IdentityAccount | undefined>;
  /** Every federated account the identity provider vouches for, in id order: what the provider's removal deletes. */
  findByProvider(
    providerOrg: string,
    providerSlug: string,
  ): Promise<ReadonlyArray<IdentityAccount>>;
  /**
   * The accounts that belong to one organization: every account whose row
   * names it in `metadata.org` (a platform client's end users, a
   * composition's own per-organization accounts), in no promised order. A
   * person's own account names no organization and is never answered.
   * The organization's purge reads it (domain/identityaccount/purge.ts).
   */
  findByOrg(org: string): Promise<ReadonlyArray<IdentityAccount>>;
}
