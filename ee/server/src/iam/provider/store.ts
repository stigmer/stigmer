/**
 * The IdentityProvider row store's port: what the provider lanes, the
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
 */
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";

import type { ProviderRoute } from "./routes.js";
import type { GuardedWritePort } from "@stigmer/server";

/** A new provider's outcomes: written, or a claim another provider already holds. */
export type ProviderInsertOutcome =
  | { readonly kind: "inserted" }
  | { readonly kind: "slug-taken" }
  | { readonly kind: "route-taken"; readonly route: ProviderRoute };

/**
 * A guarded rewrite's outcomes: rewritten, a claimed route, or the row
 * changed or gone since it was read (the guarded write's loss).
 */
export type ProviderSwapOutcome =
  | { readonly kind: "replaced" }
  | { readonly kind: "route-taken"; readonly route: ProviderRoute }
  | { readonly kind: "changed" };

export interface IdentityProviderStore
  extends GuardedWritePort<IdentityProvider, ProviderSwapOutcome> {
  /** Adds a provider and claims its routes, all or nothing. */
  insert(provider: IdentityProvider): Promise<ProviderInsertOutcome>;
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
    provider: IdentityProvider,
  ): Promise<ProviderSwapOutcome>;
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
    modify: (provider: IdentityProvider) => void,
  ): Promise<IdentityProvider | undefined>;
  /** The row and its route claims; an unknown id is a no-op. */
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<IdentityProvider | undefined>;
  /** The organization's providers, newest first. */
  findByOrg(org: string): Promise<ReadonlyArray<IdentityProvider>>;
  /** The ids of the organization's providers (the organization delete's sweep). */
  findIdsByOrg(org: string): Promise<ReadonlyArray<string>>;
  /** Answered from the route side table (the check IS the constraint). */
  findProviderIdByRoute(issuer: string, audience: string): Promise<string | undefined>;
  /** Every provider, those being deleted included (the boot reconcile). */
  findAll(): Promise<ReadonlyArray<IdentityProvider>>;
  /** Every provider not being deleted (the federated verifier's routing). */
  findLive(): Promise<ReadonlyArray<IdentityProvider>>;
  /**
   * Marks the provider as being deleted, keeping its row and its routes;
   * marking a marked provider changes nothing, and an unknown id is a no-op.
   */
  markDeleting(id: string): Promise<void>;
  /** Whether the provider's row exists and is not being deleted. */
  isLive(id: string): Promise<boolean>;
}
