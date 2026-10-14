/**
 * An in-memory IdentityProviderStore for the unit suites: the same
 * outcomes the Postgres store answers (a slug taken within an
 * organization, a route, an issuer with an audience, another provider
 * claims, a replace of a row that is gone; newest first per
 * organization; a provider being deleted skipped by the routing read and
 * by `isLive`, and answered by every other read; a provider not
 * fully shaped by its chain refused), held to
 * the port's contract kit beside the Postgres store
 * (in-memory-provider-store.test.ts), so the chains, the
 * removal and the reconcile are exercised without a database. A host's
 * adapter is pinned to the same contract over its real tables in its own
 * suites.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { stampEtag } from "@stigmer/server";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
  ApiResourceAuditStatusSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerSpecSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/spec_pb";

import type { GuardedRead, ListIndexCursor, ListIndexRow } from "@stigmer/server";

import { pageNewestFirst } from "../../../__test-utils__/in-memory-keyset.js";

import { routesOf, type ProviderRoute } from "../routes.js";
import type {
  FederationIssuerStore,
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

function unshapedRefusal(provider: FederationIssuer): Error | undefined {
  const shaped =
    (provider.metadata?.id ?? "") !== "" &&
    (provider.metadata?.org ?? "") !== "" &&
    (provider.metadata?.slug ?? "") !== "" &&
    provider.status?.audit?.specAudit?.createdAt !== undefined;
  return shaped
    ? undefined
    : new Error("a provider reaches the store fully shaped: id, organization, slug and audit are all set by its chain");
}

export class InMemoryProviderStore implements FederationIssuerStore {
  private readonly rows = new Map<string, FederationIssuer>();
  /** Ids in insertion order, the newest last. */
  private readonly order: string[] = [];
  /** The providers marked as being deleted (the Postgres `deleting_since`). */
  private readonly deleting = new Set<string>();

  insert(provider: FederationIssuer): Promise<ProviderInsertOutcome> {
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
    const taken = this.routeClaimedByAnother(provider, id);
    if (taken !== undefined) {
      return Promise.resolve({ kind: "route-taken", route: taken });
    }
    // Every write stamps the etag, as the drivers do.
    stampEtag(FederationIssuerSchema, provider);
    this.rows.set(id, clone(FederationIssuerSchema, provider));
    this.order.push(id);
    return Promise.resolve({ kind: "inserted" });
  }

  readForWrite(id: string): Promise<GuardedRead<FederationIssuer> | undefined> {
    const held = this.rows.get(id);
    return Promise.resolve(
      held === undefined
        ? undefined
        : { row: clone(FederationIssuerSchema, held), bytes: toBinary(FederationIssuerSchema, held) },
    );
  }

  swap(id: string, expectedBytes: Uint8Array, provider: FederationIssuer): Promise<ProviderSwapOutcome> {
    const refused = unshapedRefusal(provider);
    if (refused !== undefined) {
      return Promise.reject(refused);
    }
    const held = this.rows.get(id);
    if (held === undefined || !sameBytes(toBinary(FederationIssuerSchema, held), expectedBytes)) {
      return Promise.resolve({ kind: "changed" });
    }
    if ((held.metadata?.slug ?? "") !== (provider.metadata?.slug ?? "")) {
      return Promise.reject(new Error("a swap keeps a provider's slug; a rename changes it"));
    }
    const taken = this.routeClaimedByAnother(provider, id);
    if (taken !== undefined) {
      return Promise.resolve({ kind: "route-taken", route: taken });
    }
    // Every write stamps the etag, as the drivers do.
    stampEtag(FederationIssuerSchema, provider);
    this.rows.set(id, clone(FederationIssuerSchema, provider));
    return Promise.resolve({ kind: "replaced" });
  }

  modifyById(id: string, modify: (provider: FederationIssuer) => void): Promise<FederationIssuer | undefined> {
    const held = this.rows.get(id);
    if (held === undefined) {
      return Promise.resolve(undefined);
    }
    const provider = clone(FederationIssuerSchema, held);
    modify(provider);
    const claims = (row: FederationIssuer) =>
      JSON.stringify([
        row.metadata?.org ?? "",
        routesOf(row).map((route) => `${route.issuer} ${route.audience}`).sort(),
      ]);
    if (claims(held) !== claims(provider)) {
      return Promise.reject(
        new Error(
          "modifyById changes a provider's payload and slug alone; its organization and routes change through replace",
        ),
      );
    }
    // Every write stamps the etag, as the drivers do.
    stampEtag(FederationIssuerSchema, provider);
    this.rows.set(id, clone(FederationIssuerSchema, provider));
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

  findById(id: string): Promise<FederationIssuer | undefined> {
    return Promise.resolve(this.copy(this.rows.get(id)));
  }

  pageByOrg(
    org: string,
    after: ListIndexCursor | undefined,
    limit: number | undefined,
  ): Promise<ReadonlyArray<ListIndexRow>> {
    const entries = [...this.rows.values()]
      .filter((row) => row.metadata?.org === org)
      .map((row) => ({
        id: row.metadata?.id ?? "",
        data: toBinary(FederationIssuerSchema, row),
        createdAt: row.status?.audit?.specAudit?.createdAt,
      }));
    return Promise.resolve(pageNewestFirst(entries, after, limit));
  }

  /** The organization's providers, newest first: the suites' read of what a list would hold. */
  inOrg(org: string): ReadonlyArray<FederationIssuer> {
    return [...this.order]
      .reverse()
      .map((id) => this.rows.get(id))
      .filter((row): row is FederationIssuer => row?.metadata?.org === org)
      .map((row) => clone(FederationIssuerSchema, row));
  }

  findIdsByOrg(org: string): Promise<ReadonlyArray<string>> {
    return Promise.resolve(this.order.filter((id) => this.rows.get(id)?.metadata?.org === org));
  }

  findProviderIdByRoute(issuer: string, audience: string): Promise<string | undefined> {
    return Promise.resolve(
      [...this.rows.values()].find((row) =>
        routesOf(row).some((route) => route.issuer === issuer && route.audience === audience),
      )?.metadata?.id,
    );
  }

  findAll(): Promise<ReadonlyArray<FederationIssuer>> {
    return Promise.resolve([...this.rows.values()].map((row) => clone(FederationIssuerSchema, row)));
  }

  findLive(): Promise<ReadonlyArray<FederationIssuer>> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([id]) => !this.deleting.has(id))
        .map(([, row]) => clone(FederationIssuerSchema, row)),
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

  private routeClaimedByAnother(provider: FederationIssuer, id: string): ProviderRoute | undefined {
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

  private copy(provider: FederationIssuer | undefined): FederationIssuer | undefined {
    return provider === undefined ? undefined : clone(FederationIssuerSchema, provider);
  }
}

/** A stored provider as the create chain shapes one. */
export function storedProvider(fields: {
  id: string;
  org: string;
  slug: string;
  issuers?: ReadonlyArray<string>;
  expectedAudience?: string;
  createdAt?: Date;
}): FederationIssuer {
  const stamp = timestampFromDate(fields.createdAt ?? new Date("2026-09-25T10:00:00Z"));
  return create(FederationIssuerSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityProvider",
    metadata: create(ApiResourceMetadataSchema, {
      id: fields.id,
      org: fields.org,
      slug: fields.slug,
      name: fields.slug,
    }),
    spec: create(FederationIssuerSpecSchema, {
      displayName: fields.slug,
      allowedIssuers: [...(fields.issuers ?? [`https://${fields.slug}.idp.test`])],
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
