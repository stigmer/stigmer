/**
 * The PlatformClientStore PORT: the storage contract the platform-client
 * domain writes and reads through, so the cloud serves the same chains
 * over its own `cloud.iam_platform_client` table by registering an
 * implementation as `drivers.platformClientStore` (the identity-account
 * and IamPolicy precedent: a port for an IAM kind whose rows an edition
 * keeps in its own table). Open source's implementation is
 * resource-store.ts over the generic Store.
 *
 * The methods are exactly the lookups the domain asks: by id (every
 * chain, and the verifier's liveness read), by client_id (the mint), by
 * org-scoped slug (getByReference, update addressed by slug, the
 * duplicate check), by organization (listByOrg). A port carries nothing
 * only one edition calls.
 *
 * One write is atomic: `modifyById`, the port's rendering of
 * `Store.updateResource`, for the status the platform writes on its own
 * (the mint's last-use stamp, identity/credential-use.ts). `update` stays
 * a whole-row replace for the chains that load, edit and persist; a stamp
 * written that way would race them and could restore a rotated secret. The
 * driver supplies only the atomicity; what `modify` does stays the
 * domain's, written once for every edition.
 *
 * Contract every implementation must satisfy — proven by the port-contract
 * kit (store-contract.ts, exported), which the OSS adapter's test iterates
 * on both drivers and a composition's driver test iterates too:
 *   - `save` is create-only in effect: a held id, a held (org, slug) or a
 *     held client_id raises DuplicatePlatformClientError, never a silent
 *     overwrite;
 *   - `update` replaces by id and never creates: an unknown id writes
 *     nothing;
 *   - `modifyById` reads the row, applies `modify` and persists the result
 *     in one atomic step, so no concurrent write is lost; it answers the
 *     persisted row, an unknown id answers `undefined` and writes nothing,
 *     and a `modify` that throws writes nothing and rejects with its error;
 *   - `deleteById` of an unknown id resolves;
 *   - `findByOrg` answers every client of the organization and no other,
 *     in no promised order (the chain sorts);
 *   - a typed not-found reads as `undefined`; any other storage failure
 *     propagates as the infrastructure fault it is (the ratified
 *     store-fault mapping — an outage must never read as "no client", which
 *     on the verifier's path would revoke every live token).
 */
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

/**
 * Raised by `save` when the id, the (org, slug) pair or the client_id is
 * already held, so the create chain answers ALREADY_EXISTS. `cause`
 * carries a driver's own error (the cloud's SQLSTATE 23505) for the logs;
 * the message is the port's.
 */
export class DuplicatePlatformClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DuplicatePlatformClientError";
  }
}

export interface PlatformClientStore {
  /** Insert; a held id, (org, slug) or client_id raises DuplicatePlatformClientError. */
  save(client: PlatformClient): Promise<void>;
  /** Full-row replace by id; an unknown id writes nothing. */
  update(client: PlatformClient): Promise<void>;
  /**
   * Atomic read-modify-write by id: `modify` mutates the stored client in
   * place and the result is persisted, or nothing is. `modify` MUST be
   * synchronous (Store.updateResource's rule: a driver may hold a write
   * transaction or a row lock while it runs). Answers the persisted client;
   * an unknown id answers `undefined`.
   */
  modifyById(
    id: string,
    modify: (client: PlatformClient) => void,
  ): Promise<PlatformClient | undefined>;
  /** Removes the row; no error when it does not exist. */
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<PlatformClient | undefined>;
  /** The client holding this public identifier — the mint's lookup. */
  findByClientId(clientId: string): Promise<PlatformClient | undefined>;
  findByOrgAndSlug(
    org: string,
    slug: string,
  ): Promise<PlatformClient | undefined>;
  /** Every client of the organization, in no promised order. */
  findByOrg(org: string): Promise<ReadonlyArray<PlatformClient>>;
}
