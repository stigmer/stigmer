/**
 * The IdentityProviderStore contract kit (store.ts): every outcome a driver
 * of the port must answer identically, as cases a driver's test iterates.
 * It runs over the in-memory store the unit suites use and over the adapter
 * a host runs, so the published suites exercise a double proven equal to a
 * real driver.
 *
 * The lines, in the port's words:
 *   - a provider reaches the store fully shaped (id, organization, slug
 *     and audit set by its chain), and one that is not is refused as the
 *     programming error it is, with nothing written;
 *   - an insert is written with its routes, the pair (issuer, audience)
 *     for each issuer, and read back;
 *   - a slug the organization holds is `slug-taken`, while the same slug in
 *     another organization is admitted;
 *   - a route another provider holds is `route-taken`, on insert and on
 *     swap, the refused write leaving nothing behind; the same issuer
 *     with another audience is another route, and a provider with no
 *     audience claims none;
 *   - a provider's routes are a set: one naming an issuer twice claims its
 *     route once, and is admitted on insert and on swap;
 *   - a swap of a row that is gone is `changed`, and writes nothing;
 *   - the guarded write (`@stigmer/server`'s guarded-port kit): a swap on
 *     the bytes readForWrite answered is `replaced`, and is `changed` after
 *     any write in between (a rename through modifyById among them), on a
 *     row deleted since, or on bytes a landed swap replaced;
 *   - modifyById changes the payload and the slug together, so the old
 *     slug is free in the table and the new one taken, keeps the routes,
 *     refuses a change of a route as a programming error,
 *     and answers undefined for an unknown id, writing nothing;
 *   - an organization's list is newest first, ties broken by id in byte
 *     order, strictly after a cursor and at most a limit, and no other
 *     organization's;
 *   - a delete frees the provider's routes, and an unknown id resolves;
 *   - a provider marked as being deleted leaves the routing read
 *     (`findLive`) and is not live, while every other
 *     read still answers it and its routes stay claimed until its row
 *     goes; a mark is idempotent, and marking an unknown id writes nothing;
 *   - an outage is a fault, never "no provider": a route read that answered
 *     `undefined` from a broken store would let a create take a held route.
 *
 * Shape: the library's kits' (`store/port-contract.ts` in `@stigmer/server`),
 * over its exported runner: a fresh fixture per case, a failing assertion
 * winning over a failing cleanup, node:assert rather than a test framework
 * so the kit ships with the code it describes.
 */
import assert from "node:assert/strict";

import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import {
  etagOf,
  guardedPortDeclarations,
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { FederationIssuerStore, ProviderSwapOutcome } from "./store.js";

/** The runner's fixture over this port. */
export type FederationIssuerStoreContractFixture = PortContractFixture<FederationIssuerStore>;

const AUDIENCE = "https://api.contract.test/stigmer";
const CREATED = timestampFromDate(new Date("2026-09-01T00:00:00Z"));

function provider(fields: {
  id: string;
  org: string;
  slug: string;
  issuers: ReadonlyArray<string>;
  audience?: string;
  displayName?: string;
  /** Minutes after the shared creation instant, to order a list. */
  minute?: number;
}): FederationIssuer {
  const created =
    fields.minute === undefined
      ? CREATED
      : timestampFromDate(new Date(Date.UTC(2026, 8, 1, 0, fields.minute)));
  return create(FederationIssuerSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityProvider",
    metadata: { id: fields.id, org: fields.org, slug: fields.slug, name: fields.slug },
    status: { audit: { specAudit: { createdAt: created, updatedAt: created } } },
    spec: {
      displayName: fields.displayName ?? fields.slug,
      allowedIssuers: [...fields.issuers],
      expectedAudience: fields.audience ?? AUDIENCE,
    },
  });
}

/**
 * A swap on the provider's current bytes: the update chain's write when
 * nothing landed between its read and its write. A row that is gone swaps
 * on no bytes.
 */
async function swapOnCurrent(
  store: FederationIssuerStore,
  next: FederationIssuer,
): Promise<ProviderSwapOutcome> {
  const id = next.metadata?.id ?? "";
  const read = await store.readForWrite(id);
  return store.swap(id, read?.bytes ?? new Uint8Array(), next);
}

const CASES: ReadonlyArray<PortContractDeclaration<FederationIssuerStore>> = [
  [
    "every write stores the etag its content gives: an insert, a modify and a swap",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_etag", org: "acme", slug: "etag-first", issuers: ["https://etag.contract.test"] }));
      const inserted = await store.findById("idp_etag");
      assert.ok(inserted !== undefined, "the insert is read back");
      assert.notEqual(inserted.metadata?.etag ?? "", "", "an insert stamps the etag");
      assert.equal(inserted.metadata?.etag, etagOf(FederationIssuerSchema, inserted));
      await store.modifyById("idp_etag", (held) => {
        if (held.metadata !== undefined) {
          held.metadata.name = "Second";
        }
      });
      const modified = await store.findById("idp_etag");
      assert.ok(modified !== undefined);
      assert.equal(modified.metadata?.etag, etagOf(FederationIssuerSchema, modified), "a modify restamps it");
      assert.notEqual(modified.metadata?.etag, inserted.metadata?.etag);
      const next = clone(FederationIssuerSchema, modified);
      if (next.spec !== undefined) {
        next.spec.displayName = "Third";
      }
      assert.deepEqual(await swapOnCurrent(store, next), { kind: "replaced" });
      const swapped = await store.findById("idp_etag");
      assert.ok(swapped !== undefined);
      assert.equal(swapped.metadata?.etag, etagOf(FederationIssuerSchema, swapped), "a swap restamps it");
      assert.notEqual(swapped.metadata?.etag, modified.metadata?.etag);
    },
  ],
  [
    "modifyById changes the payload and the slug together and keeps the routes; a claim change is refused, and an unknown id writes nothing",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_r2", org: "acme", slug: "before-move", issuers: ["https://moved.contract.test"] }));
      const moveTo = (slug: string) => (held: FederationIssuer) => {
        if (held.metadata !== undefined) {
          held.metadata.slug = slug;
        }
      };
      const written = await store.modifyById("idp_r2", moveTo("after-move"));
      assert.equal(written?.metadata?.slug, "after-move");
      assert.equal((await store.findById("idp_r2"))?.metadata?.slug, "after-move");
      assert.equal(await store.findProviderIdByRoute("https://moved.contract.test", AUDIENCE), "idp_r2", "the routes stay");
      assert.deepEqual(
        await store.insert(provider({ id: "idp_r3", org: "acme", slug: "after-move", issuers: ["https://r3.contract.test"] })),
        { kind: "slug-taken" },
        "the new slug is held",
      );
      assert.deepEqual(
        await store.insert(provider({ id: "idp_r4", org: "acme", slug: "before-move", issuers: ["https://r4.contract.test"] })),
        { kind: "inserted" },
        "the old slug is free in the table",
      );
      await assert.rejects(
        store.modifyById("idp_r2", (held) => {
          if (held.spec !== undefined) {
            held.spec.allowedIssuers = ["https://elsewhere.contract.test"];
          }
        }),
        "a route change is the swap's",
      );
      assert.equal(await store.findProviderIdByRoute("https://moved.contract.test", AUDIENCE), "idp_r2");
      assert.equal(await store.modifyById("idp_unknown", moveTo("anything")), undefined);
    },
  ],
  [
    "a provider not fully shaped is refused on insert and swap, and nothing is written",
    async ({ store }) => {
      const unslugged = provider({ id: "idp_c0", org: "acme", slug: "", issuers: ["https://unshaped.contract.test"] });
      await assert.rejects(store.insert(unslugged), "an insert without a slug is refused");
      const unaudited = provider({ id: "idp_c0", org: "acme", slug: "unshaped", issuers: ["https://unshaped.contract.test"] });
      unaudited.status = undefined;
      await assert.rejects(store.insert(unaudited), "an insert without its audit is refused");
      const unnamed = provider({ id: "idp_c0", org: "acme", slug: "unshaped", issuers: ["https://unshaped.contract.test"] });
      unnamed.metadata = undefined;
      await assert.rejects(store.insert(unnamed), "an insert without its metadata is refused");
      assert.equal(await store.findById("idp_c0"), undefined);
      assert.equal(await store.findProviderIdByRoute("https://unshaped.contract.test", AUDIENCE), undefined);
      await store.insert(provider({ id: "idp_c0b", org: "acme", slug: "shaped", issuers: ["https://shaped.contract.test"] }));
      const reshaped = provider({ id: "idp_c0b", org: "acme", slug: "shaped", issuers: ["https://shaped.contract.test"] });
      reshaped.status = undefined;
      await assert.rejects(swapOnCurrent(store, reshaped), "a swap without its audit is refused");
    },
  ],
  [
    "an insert is written with its routes and read back by id, by organization and by route",
    async ({ store }) => {
      const written = provider({ id: "idp_c1", org: "acme", slug: "okta", issuers: ["https://okta.contract.test"] });
      assert.deepEqual(await store.insert(written), { kind: "inserted" });
      assert.equal((await store.findById("idp_c1"))?.spec?.displayName, "okta");
      assert.equal(await store.findProviderIdByRoute("https://okta.contract.test", AUDIENCE), "idp_c1");
      assert.deepEqual(await store.findIdsByOrg("acme"), ["idp_c1"]);
    },
  ],
  [
    "the list is newest first, ties by id in byte order, strictly after a cursor and at most a limit",
    async ({ store }) => {
      for (const [id, minute] of [
        ["idp_k_old", 1],
        ["idp_k_a", 2],
        ["idp_k_B", 2],
        ["idp_k_new", 3],
      ] as const) {
        await store.insert(
          provider({
            id,
            org: "keyset",
            slug: id.replaceAll("_", "-").toLowerCase(),
            issuers: [`https://${id}.contract.test`],
            minute,
          }),
        );
      }
      await store.insert(provider({ id: "idp_k_other", org: "elsewhere", slug: "k-other", issuers: ["https://k-other.contract.test"] }));

      // Byte order puts "B" (0x42) before "a" (0x61), so newest first reads
      // idp_k_a before idp_k_B; a collation-aware order would not.
      const all = await store.pageByOrg("keyset", undefined, undefined);
      assert.deepEqual(all.map((row) => row.id), ["idp_k_new", "idp_k_a", "idp_k_B", "idp_k_old"]);
      assert.deepEqual(all[1]?.cursor, { createdAt: "2026-09-01T00:02:00.000000Z", id: "idp_k_a" });

      const first = await store.pageByOrg("keyset", undefined, 2);
      assert.deepEqual(first.map((row) => row.id), ["idp_k_new", "idp_k_a"]);
      const rest = await store.pageByOrg("keyset", first[1]?.cursor, 2);
      assert.deepEqual(rest.map((row) => row.id), ["idp_k_B", "idp_k_old"]);
      assert.deepEqual(await store.pageByOrg("keyset", rest[1]?.cursor, 2), []);
    },
  ],
  [
    "a slug the organization holds is slug-taken, and the same slug in another organization is admitted",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c2", org: "acme", slug: "sso", issuers: ["https://a.contract.test"] }));
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c3", org: "acme", slug: "sso", issuers: ["https://b.contract.test"] })),
        { kind: "slug-taken" },
      );
      assert.equal(await store.findById("idp_c3"), undefined, "a refused insert writes no row");
      assert.equal(
        await store.findProviderIdByRoute("https://b.contract.test", AUDIENCE),
        undefined,
        "a refused insert claims no route",
      );
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c4", org: "beta", slug: "sso", issuers: ["https://c.contract.test"] })),
        { kind: "inserted" },
      );
    },
  ],
  [
    "a route another provider holds is route-taken on insert, while the same issuer with another audience is admitted",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c5", org: "acme", slug: "one", issuers: ["https://shared.contract.test"] }));
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c6", org: "beta", slug: "two", issuers: ["https://shared.contract.test"] })),
        { kind: "route-taken", route: { issuer: "https://shared.contract.test", audience: AUDIENCE } },
      );
      assert.equal(await store.findById("idp_c6"), undefined, "a refused insert writes no row");
      assert.deepEqual(
        await store.insert(
          provider({ id: "idp_c7", org: "beta", slug: "three", issuers: ["https://shared.contract.test"], audience: "https://api.beta.contract.test" }),
        ),
        { kind: "inserted" },
      );
      assert.equal(await store.findProviderIdByRoute("https://shared.contract.test", "https://api.beta.contract.test"), "idp_c7");
      assert.equal(await store.findProviderIdByRoute("https://shared.contract.test", AUDIENCE), "idp_c5");
    },
  ],
  [
    "a provider with no audience claims no route",
    async ({ store }) => {
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c8", org: "acme", slug: "bare", issuers: ["https://bare.contract.test"], audience: "" })),
        { kind: "inserted" },
      );
      assert.equal(await store.findProviderIdByRoute("https://bare.contract.test", ""), undefined);
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c9", org: "beta", slug: "claims", issuers: ["https://bare.contract.test"] })),
        { kind: "inserted" },
        "an unrouted provider holds nothing another may not take",
      );
    },
  ],
  [
    "a provider naming one issuer twice claims its route once, and is admitted",
    async ({ store }) => {
      const twice = ["https://twice.contract.test", "https://twice.contract.test"];
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c17", org: "acme", slug: "twice", issuers: twice })),
        { kind: "inserted" },
      );
      assert.equal(await store.findProviderIdByRoute("https://twice.contract.test", AUDIENCE), "idp_c17");
      assert.deepEqual(
        await swapOnCurrent(store, 
          provider({ id: "idp_c17", org: "acme", slug: "twice", issuers: [...twice, "https://more.contract.test", "https://more.contract.test"] }),
        ),
        { kind: "replaced" },
      );
      assert.equal(await store.findProviderIdByRoute("https://more.contract.test", AUDIENCE), "idp_c17");
    },
  ],
  [
    "a swap rewrites the payload and the routes; a route another provider holds is route-taken and writes nothing",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c10", org: "acme", slug: "held", issuers: ["https://held.contract.test"] }));
      await store.insert(provider({ id: "idp_c11", org: "beta", slug: "moving", issuers: ["https://before.contract.test"] }));
      assert.deepEqual(
        await swapOnCurrent(store, provider({ id: "idp_c11", org: "beta", slug: "moving", issuers: ["https://after.contract.test"], displayName: "moved" })),
        { kind: "replaced" },
      );
      assert.equal((await store.findById("idp_c11"))?.spec?.displayName, "moved");
      assert.equal(await store.findProviderIdByRoute("https://after.contract.test", AUDIENCE), "idp_c11");
      assert.equal(await store.findProviderIdByRoute("https://before.contract.test", AUDIENCE), undefined, "a replaced route is released");
      assert.deepEqual(
        await swapOnCurrent(store, provider({ id: "idp_c11", org: "beta", slug: "moving", issuers: ["https://held.contract.test"], displayName: "grabbed" })),
        { kind: "route-taken", route: { issuer: "https://held.contract.test", audience: AUDIENCE } },
      );
      assert.equal((await store.findById("idp_c11"))?.spec?.displayName, "moved", "a refused swap writes nothing");
      assert.equal(await store.findProviderIdByRoute("https://after.contract.test", AUDIENCE), "idp_c11", "and keeps the routes it held");
    },
  ],
  [
    "a swap of a row that is gone is changed, and writes nothing",
    async ({ store }) => {
      assert.deepEqual(
        await swapOnCurrent(store, provider({ id: "idp_c12", org: "acme", slug: "ghost", issuers: ["https://ghost.contract.test"] })),
        { kind: "changed" },
      );
      assert.equal(await store.findById("idp_c12"), undefined);
      assert.equal(await store.findProviderIdByRoute("https://ghost.contract.test", AUDIENCE), undefined);
    },
  ],
  [
    "a delete frees the provider's routes, and an unknown id resolves",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c15", org: "acme", slug: "gone", issuers: ["https://gone.contract.test"] }));
      await store.deleteById("idp_c15");
      assert.equal(await store.findById("idp_c15"), undefined);
      assert.equal(await store.findProviderIdByRoute("https://gone.contract.test", AUDIENCE), undefined);
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c16", org: "beta", slug: "next", issuers: ["https://gone.contract.test"] })),
        { kind: "inserted" },
        "a freed route may be registered again",
      );
      await assert.doesNotReject(store.deleteById("idp_unknown"));
    },
  ],
  [
    "a provider being deleted leaves the routing read and is not live, while every other read still answers it and its routes stay claimed",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c18", org: "acme", slug: "leaving", issuers: ["https://leaving.contract.test"] }));
      await store.insert(provider({ id: "idp_c19", org: "acme", slug: "staying", issuers: ["https://staying.contract.test"] }));
      assert.equal(await store.isLive("idp_c18"), true);

      await store.markDeleting("idp_c18");

      assert.equal(await store.isLive("idp_c18"), false);
      assert.equal(await store.isLive("idp_c19"), true, "the mark is the one provider's");
      assert.deepEqual((await store.findLive()).map((live) => live.metadata?.id), ["idp_c19"]);
      assert.deepEqual(
        (await store.findAll()).map((held) => held.metadata?.id).sort(),
        ["idp_c18", "idp_c19"],
        "the boot reconcile still sees it",
      );
      assert.equal((await store.findById("idp_c18"))?.metadata?.id, "idp_c18");
      assert.deepEqual([...(await store.findIdsByOrg("acme"))].sort(), ["idp_c18", "idp_c19"]);
      assert.equal(
        await store.findProviderIdByRoute("https://leaving.contract.test", AUDIENCE),
        "idp_c18",
        "its routes stay claimed until its row goes",
      );

      await store.deleteById("idp_c18");
      assert.equal(await store.findProviderIdByRoute("https://leaving.contract.test", AUDIENCE), undefined);
      assert.equal(await store.isLive("idp_c18"), false);
    },
  ],
  [
    "a delete mark is idempotent, and marking an unknown id writes nothing",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c20", org: "acme", slug: "twice-marked", issuers: ["https://twice-marked.contract.test"] }));
      await store.markDeleting("idp_c20");
      await assert.doesNotReject(store.markDeleting("idp_c20"));
      assert.equal(await store.isLive("idp_c20"), false);
      await assert.doesNotReject(store.markDeleting("idp_unknown"));
      assert.equal(await store.isLive("idp_unknown"), false);
      assert.deepEqual((await store.findAll()).map((held) => held.metadata?.id), ["idp_c20"]);
    },
  ],
  [
    "an outage is a fault, never 'no provider'",
    async ({ store, disconnect }) => {
      await disconnect();
      await assert.rejects(store.findProviderIdByRoute("https://any.contract.test", AUDIENCE));
      await assert.rejects(store.findById("idp_any"));
      await assert.rejects(store.pageByOrg("acme", undefined, undefined));
      await assert.rejects(store.findAll());
      await assert.rejects(store.findLive());
      await assert.rejects(store.isLive("idp_any"), "an outage never reads as 'not live'");
    },
  ],
  ...guardedPortDeclarations<FederationIssuerStore, FederationIssuer, ProviderSwapOutcome>({
    landed: (outcome) => outcome.kind === "replaced",
    async seed(store) {
      const seeded = provider({ id: "idp_cg", org: "acme", slug: "guarded", issuers: ["https://guarded.contract.test"] });
      await store.insert(seeded);
      return seeded;
    },
    idOf: (held) => held.metadata?.id ?? "",
    change(held, value) {
      if (held.spec !== undefined) {
        held.spec.displayName = value;
      }
    },
    changedValueOf: (held) => held.spec?.displayName ?? "",
    async interleave(store, id, value) {
      await store.modifyById(id, (held) => {
        if (held.spec !== undefined) {
          held.spec.displayName = value;
        }
      });
    },
    read: (store, id) => store.findById(id),
    remove: (store, id) => store.deleteById(id),
  }),
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function federationIssuerStoreContract(
  makeFixture: () => Promise<FederationIssuerStoreContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(CASES, makeFixture);
}
