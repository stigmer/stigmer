/**
 * The IdentityProvider row store's port: what the provider lanes, the
 * federated verifier and the removals read and write. The host's Postgres
 * adapter is postgres-store.ts beside it.
 *
 * "Someone else holds this" is a typed outcome (a slug, the
 * organization's SSO place, a route), never an exception the
 * handler has to recognise. A route is the pair (canonical issuer,
 * audience): one provider per route across the platform. A token is routed
 * by both claims, so organizations that federate with one issuer each hold
 * their own audience, and nobody holds an issuer for everyone. A provider
 * with no audience claims no route. An organization holds at most one live
 * SSO provider. A write never upserts: `insert` cannot overwrite a row, and
 * `replace` cannot bring back a row a concurrent delete removed.
 *
 * A provider being deleted keeps its row until its delete finishes
 * (removal.ts says why the row goes last): `markDeleting` sets the mark,
 * and from then on the reads that trust a provider to sign people in skip
 * it: `findLive`, the federated verifier's routing read, and
 * `findSsoProviderByOrg`, the login page's discovery. `isLive` is the one
 * read a sign-in that has written asks before it answers. Every other read
 * still answers a marked provider: its admins see it, a retried delete
 * finds it, and the boot reconcile can give it back an organization link a
 * faulted delete already revoked. The mark keeps the provider's routes, so
 * no other provider claims them before the row is gone.
 *
 * A provider's slug is rename's alone (`@stigmer/server`'s rename chain
 * over `modifyById`): `replace` keeps the stored slug under the row's lock,
 * so an update that loaded the provider before a rename never writes the
 * old slug back.
 *
 * `findAll` and `findLive` are deliberate full-table reads: the boot
 * reconcile wants every provider, the verifier's issuer-cache rebuild
 * every live one, and provider cardinality is platform-scale, not
 * tenant-scale.
 */
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";

import type { ProviderRoute } from "./routes.js";

/** A new provider's outcomes: written, or a claim another provider already holds. */
export type ProviderInsertOutcome =
  | { readonly kind: "inserted" }
  | { readonly kind: "slug-taken" }
  | { readonly kind: "sso-taken" }
  | { readonly kind: "route-taken"; readonly route: ProviderRoute };

/**
 * A held provider's outcomes: rewritten, the organization's SSO place held
 * by another provider, a claimed route, or gone since it was read.
 */
export type ProviderReplaceOutcome =
  | { readonly kind: "replaced" }
  | { readonly kind: "sso-taken" }
  | { readonly kind: "route-taken"; readonly route: ProviderRoute }
  | { readonly kind: "missing" };

export interface IdentityProviderStore {
  /** Adds a provider and claims its routes, all or nothing. */
  insert(provider: IdentityProvider): Promise<ProviderInsertOutcome>;
  /**
   * Rewrites a held provider's payload, SSO flag and route claims, all
   * or nothing, under the row's lock. The stored slug is kept, and written
   * onto `provider` too; the org and slug columns do not change.
   */
  replace(provider: IdentityProvider): Promise<ProviderReplaceOutcome>;
  /**
   * Atomic read-modify-write by id under the row's lock, for a change of
   * the payload and the slug alone (a rename): `modify` mutates the stored
   * provider in place (synchronously), and the payload and the slug column
   * are written together. A change of the SSO flag or the routes is
   * `replace`'s and is refused as a programming error. Answers the written
   * provider; an unknown id answers undefined and writes nothing.
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
  /** The organization's SSO provider, unless it is being deleted. */
  findSsoProviderByOrg(org: string): Promise<IdentityProvider | undefined>;
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
