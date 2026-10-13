/**
 * An in-memory IdentityProviderStore for the unit suites: the same
 * outcomes the Postgres store answers (a slug taken within an
 * organization, the organization's one live SSO place held by another
 * provider, a route, an issuer with an audience, another provider
 * claims, a replace of a row that is gone; newest first per
 * organization; a provider being deleted skipped by the routing and SSO
 * reads and by `isLive`, and answered by every other read; a provider not
 * fully shaped by its chain refused), held to
 * the port's contract kit beside the Postgres store
 * (in-memory-provider-store.test.ts), so the chains, the
 * removal and the reconcile are exercised without a database. A host's
 * adapter is pinned to the same contract over its real tables in its own
 * suites.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
  ApiResourceAuditStatusSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/spec_pb";

import type { GuardedRead } from "@stigmer/server";

import { routesOf, type ProviderRoute } from "../routes.js";
import type {
  IdentityProviderStore,
  ProviderInsertOutcome,
  ProviderSwapOutcome,
} from "../store.js";

/**
 * The Postgres store's rule: a provider arrives fully shaped by its chain,
 * or the write is a programming error, answered as a rejected write the
 * way an async driver answers it.
 */
/** Whether two stored forms are the same bytes, as the Postgres swap compares them. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function unshapedRefusal(provider: IdentityProvider): Error | undefined {
  const shaped =
    (provider.metadata?.id ?? "") !== "" &&
    (provider.metadata?.org ?? "") !== "" &&
    (provider.metadata?.slug ?? "") !== "" &&
    provider.status?.audit?.specAudit?.createdAt !== undefined;
  return shaped
    ? undefined
    : new Error("a provider reaches the store fully shaped: id, organization, slug and audit are all set by its chain");
}

export class InMemoryProviderStore implements IdentityProviderStore {
  private readonly rows = new Map<string, IdentityProvider>();
  /** Ids in insertion order, the newest last. */
  private readonly order: string[] = [];
  /** The providers marked as being deleted (the Postgres `deleting_since`). */
  private readonly deleting = new Set<string>();

  insert(provider: IdentityProvider): Promise<ProviderInsertOutcome> {
    const refused = unshapedRefusal(provider);
    if (refused !== undefined) {
      return Promise.reject(refused);
    }
    const id = provider.metadata?.id ?? "";
    const org = provider.metadata?.org ?? "";
    const slug = provider.metadata?.slug ?? "";
    for (const held of this.rows.values()) {
      if (held.metadata?.org === org && held.metadata?.slug === slug) {
        return Promise.resolve({ kind: "slug-taken" });
      }
    }
    if (this.ssoHeldByAnother(provider, id)) {
      return Promise.resolve({ kind: "sso-taken" });
    }
    const taken = this.routeClaimedByAnother(provider, id);
    if (taken !== undefined) {
      return Promise.resolve({ kind: "route-taken", route: taken });
    }
    this.rows.set(id, clone(IdentityProviderSchema, provider));
    this.order.push(id);
    return Promise.resolve({ kind: "inserted" });
  }

  readForWrite(id: string): Promise<GuardedRead<IdentityProvider> | undefined> {
    const held = this.rows.get(id);
    return Promise.resolve(
      held === undefined
        ? undefined
        : { row: clone(IdentityProviderSchema, held), bytes: toBinary(IdentityProviderSchema, held) },
    );
  }

  swap(id: string, expectedBytes: Uint8Array, provider: IdentityProvider): Promise<ProviderSwapOutcome> {
    const refused = unshapedRefusal(provider);
    if (refused !== undefined) {
      return Promise.reject(refused);
    }
    const held = this.rows.get(id);
    if (held === undefined || !sameBytes(toBinary(IdentityProviderSchema, held), expectedBytes)) {
      return Promise.resolve({ kind: "changed" });
    }
    if ((held.metadata?.slug ?? "") !== (provider.metadata?.slug ?? "")) {
      return Promise.reject(new Error("a swap keeps a provider's slug; a rename changes it"));
    }
    if (this.ssoHeldByAnother(provider, id)) {
      return Promise.resolve({ kind: "sso-taken" });
    }
    const taken = this.routeClaimedByAnother(provider, id);
    if (taken !== undefined) {
      return Promise.resolve({ kind: "route-taken", route: taken });
    }
    this.rows.set(id, clone(IdentityProviderSchema, provider));
    return Promise.resolve({ kind: "replaced" });
  }

  modifyById(id: string, modify: (provider: IdentityProvider) => void): Promise<IdentityProvider | undefined> {
    const held = this.rows.get(id);
    if (held === undefined) {
      return Promise.resolve(undefined);
    }
    const provider = clone(IdentityProviderSchema, held);
    modify(provider);
    const claims = (row: IdentityProvider) =>
      JSON.stringify([
        row.metadata?.org ?? "",
        row.spec?.isSsoProvider === true,
        routesOf(row).map((route) => `${route.issuer} ${route.audience}`).sort(),
      ]);
    if (claims(held) !== claims(provider)) {
      return Promise.reject(
        new Error(
          "modifyById changes a provider's payload and slug alone; its organization, SSO flag and routes change through replace",
        ),
      );
    }
    this.rows.set(id, clone(IdentityProviderSchema, provider));
    return Promise.resolve(provider);
  }

  deleteById(id: string): Promise<void> {
    this.rows.delete(id);
    this.deleting.delete(id);
    const index = this.order.indexOf(id);
    if (index >= 0) {
      this.order.splice(index, 1);
    }
    return Promise.resolve();
  }

  findById(id: string): Promise<IdentityProvider | undefined> {
    return Promise.resolve(this.copy(this.rows.get(id)));
  }

  findByOrg(org: string): Promise<ReadonlyArray<IdentityProvider>> {
    return Promise.resolve(
      [...this.order]
        .reverse()
        .map((id) => this.rows.get(id))
        .filter((row): row is IdentityProvider => row?.metadata?.org === org)
        .map((row) => clone(IdentityProviderSchema, row)),
    );
  }

  findIdsByOrg(org: string): Promise<ReadonlyArray<string>> {
    return Promise.resolve(this.order.filter((id) => this.rows.get(id)?.metadata?.org === org));
  }

  findSsoProviderByOrg(org: string): Promise<IdentityProvider | undefined> {
    return Promise.resolve(
      this.copy(
        [...this.rows.entries()].find(
          ([id, row]) => row.metadata?.org === org && row.spec?.isSsoProvider === true && !this.deleting.has(id),
        )?.[1],
      ),
    );
  }

  findProviderIdByRoute(issuer: string, audience: string): Promise<string | undefined> {
    return Promise.resolve(
      [...this.rows.values()].find((row) =>
        routesOf(row).some((route) => route.issuer === issuer && route.audience === audience),
      )?.metadata?.id,
    );
  }

  findAll(): Promise<ReadonlyArray<IdentityProvider>> {
    return Promise.resolve([...this.rows.values()].map((row) => clone(IdentityProviderSchema, row)));
  }

  findLive(): Promise<ReadonlyArray<IdentityProvider>> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([id]) => !this.deleting.has(id))
        .map(([, row]) => clone(IdentityProviderSchema, row)),
    );
  }

  markDeleting(id: string): Promise<void> {
    if (this.rows.has(id)) {
      this.deleting.add(id);
    }
    return Promise.resolve();
  }

  isLive(id: string): Promise<boolean> {
    return Promise.resolve(this.rows.has(id) && !this.deleting.has(id));
  }

  /** The number of stored rows. */
  get size(): number {
    return this.rows.size;
  }

  /**
   * The Postgres store's partial unique index: a live SSO provider holds
   * its organization's one place, and a provider being deleted holds none.
   */
  private ssoHeldByAnother(provider: IdentityProvider, id: string): boolean {
    if (provider.spec?.isSsoProvider !== true || this.deleting.has(id)) {
      return false;
    }
    const org = provider.metadata?.org ?? "";
    return [...this.rows.entries()].some(
      ([heldId, held]) =>
        heldId !== id &&
        held.metadata?.org === org &&
        held.spec?.isSsoProvider === true &&
        !this.deleting.has(heldId),
    );
  }

  private routeClaimedByAnother(provider: IdentityProvider, id: string): ProviderRoute | undefined {
    for (const route of routesOf(provider)) {
      for (const [heldId, held] of this.rows) {
        if (
          heldId !== id &&
          routesOf(held).some((other) => other.issuer === route.issuer && other.audience === route.audience)
        ) {
          return route;
        }
      }
    }
    return undefined;
  }

  private copy(provider: IdentityProvider | undefined): IdentityProvider | undefined {
    return provider === undefined ? undefined : clone(IdentityProviderSchema, provider);
  }
}

/** A stored provider as the create chain shapes one. */
export function storedProvider(fields: {
  id: string;
  org: string;
  slug: string;
  isSso?: boolean;
  issuers?: ReadonlyArray<string>;
  expectedAudience?: string;
  createdAt?: Date;
}): IdentityProvider {
  const stamp = timestampFromDate(fields.createdAt ?? new Date("2026-09-25T10:00:00Z"));
  return create(IdentityProviderSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityProvider",
    metadata: create(ApiResourceMetadataSchema, {
      id: fields.id,
      org: fields.org,
      slug: fields.slug,
      name: fields.slug,
    }),
    spec: create(IdentityProviderSpecSchema, {
      displayName: fields.slug,
      allowedIssuers: [...(fields.issuers ?? [`https://${fields.slug}.idp.test`])],
      isSsoProvider: fields.isSso === true,
      oidcClientId: fields.isSso === true ? `client-${fields.slug}` : "",
      expectedAudience: fields.expectedAudience ?? `https://${fields.slug}.idp.test/stigmer`,
    }),
    status: create(ApiResourceAuditStatusSchema, {
      audit: create(ApiResourceAuditSchema, {
        specAudit: create(ApiResourceAuditInfoSchema, {
          createdAt: stamp,
          updatedAt: stamp,
        }),
      }),
    }),
  });
}
