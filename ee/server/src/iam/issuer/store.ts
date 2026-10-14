/**
 * The FederationIssuer row store's port: what the provider lanes, the
 * federated verifier and the removals read and write. The host's Postgres
 * adapter is postgres-store.ts beside it.
 *
 * "Someone else holds this" is a typed outcome (a slug or a route), never
 * an exception the handler has to recognise. A route is the pair (canonical issuer,
 * audience): one provider per route across the platform. A token is routed
 * by both claims, so organizations that federate with one issuer each hold
 * their own audience, and nobody holds an issuer for everyone. A provider
 * with no audience claims no route. A write never upserts: `insert` cannot overwrite a row, and
 * `swap` cannot bring back a row a concurrent delete removed.
 *
 * A provider being deleted keeps its row until its delete finishes
 * (removal.ts says why the row goes last): `markDeleting` sets the mark,
 * and from then on the reads that trust a provider to sign people in skip
 * it: `findLive`, the federated verifier's routing read. `isLive` is the one
 * read a sign-in that has written asks before it answers. Every other read
 * still answers a marked provider: its admins see it, a retried delete
 * finds it, and the boot reconcile can give it back an organization link a
 * faulted delete already revoked. The mark keeps the provider's routes, so
 * no other provider claims them before the row is gone.
 *
 * A provider's slug is rename's alone (`@stigmer/server`'s rename chain
 * over `modifyById`). The update chain writes through the guarded write
 * (`readForWrite` and `swap`, `@stigmer/server`'s store/guarded-port.ts):
 * the swap lands only while the row is as the chain read it, so a rename
 * or any other write in between answers `changed`, and the update runs
 * again from a fresh read rather than undo it.
 *
 * `findAll` and `findLive` are deliberate full-table reads: the boot
 * reconcile wants every provider, the verifier's issuer-cache rebuild
 * every live one, and provider cardinality is platform-scale, not
 * tenant-scale.
 *
 * `pageByOrg` is the organization's list as a row source for the library's
 * page loop (`readPage`): newest first, ties broken by id in byte order,
 * continuing strictly after a cursor. The cursor comes back from the client
 * inside an unsigned page token, so it can be any text: one the store would
 * never render continues nothing, an empty page, rather than a fault.
 */
import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";

import type { IssuerRoute } from "./routes.js";
import type { GuardedWritePort, ListIndexCursor, ListIndexRow } from "@stigmer/server";

/** A new provider's outcomes: written, or a claim another provider already holds. */
export type IssuerInsertOutcome =
  | { readonly kind: "inserted" }
  | { readonly kind: "slug-taken" }
  | { readonly kind: "route-taken"; readonly route: IssuerRoute };

/**
 * A guarded rewrite's outcomes: rewritten, a claimed route, or the row
 * changed or gone since it was read (the guarded write's loss).
 */
export type IssuerSwapOutcome =
  | { readonly kind: "replaced" }
  | { readonly kind: "route-taken"; readonly route: IssuerRoute }
  | { readonly kind: "changed" };

export interface FederationIssuerStore
  extends GuardedWritePort<FederationIssuer, IssuerSwapOutcome> {
  /** Adds a provider and claims its routes, all or nothing. */
  insert(provider: FederationIssuer): Promise<IssuerInsertOutcome>;
  /**
   * The guarded rewrite of a held provider's payload and route claims,
   * all or nothing, under the row's lock, and only while its payload is
   * still the bytes `readForWrite` answered (else `changed`).
   * The org and slug columns do not change: `provider` carries the slug
   * it was read with, and one naming another slug is refused as the
   * programming error it is (rename moves a slug, through `modifyById`).
   */
  swap(
    id: string,
    expectedBytes: Uint8Array,
    provider: FederationIssuer,
  ): Promise<IssuerSwapOutcome>;
  /**
   * Atomic read-modify-write by id under the row's lock, for a change of
   * the payload and the slug alone (a rename): `modify` mutates the stored
   * provider in place (synchronously), and the payload and the slug column
   * are written together. A change of the routes is `swap`'s and is
   * refused as a programming error. Answers the written provider; an
   * unknown id answers undefined and writes nothing.
   */
  modifyById(
    id: string,
    modify: (provider: FederationIssuer) => void,
  ): Promise<FederationIssuer | undefined>;
  /** The row and its route claims; an unknown id is a no-op. */
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<FederationIssuer | undefined>;
  /**
   * The organization's rows after `after` (from the newest when undefined),
   * newest first and ids in byte order, at most `limit` (every one when
   * undefined): the list's row source.
   */
  pageByOrg(
    org: string,
    after: ListIndexCursor | undefined,
    limit: number | undefined,
  ): Promise<ReadonlyArray<ListIndexRow>>;
  /** The ids of the organization's providers (the organization delete's sweep). */
  findIdsByOrg(org: string): Promise<ReadonlyArray<string>>;
  /** Answered from the route side table (the check IS the constraint). */
  findIssuerIdByRoute(issuer: string, audience: string): Promise<string | undefined>;
  /** Every provider, those being deleted included (the boot reconcile). */
  findAll(): Promise<ReadonlyArray<FederationIssuer>>;
  /** Every provider not being deleted (the federated verifier's routing). */
  findLive(): Promise<ReadonlyArray<FederationIssuer>>;
  /**
   * Marks the provider as being deleted, keeping its row and its routes;
   * marking a marked provider changes nothing, and an unknown id is a no-op.
   */
  markDeleting(id: string): Promise<void>;
  /** Whether the provider's row exists and is not being deleted. */
  isLive(id: string): Promise<boolean>;
}
