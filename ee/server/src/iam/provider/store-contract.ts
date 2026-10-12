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
 *     replace, the refused write leaving nothing behind; the same issuer
 *     with another audience is another route, and a provider with no
 *     audience claims none;
 *   - a provider's routes are a set: one naming an issuer twice claims its
 *     route once, and is admitted on insert and on replace;
 *   - an organization holds one live SSO provider: a second is `sso-taken`
 *     on insert and on a replace that makes a provider SSO, the refused
 *     write leaving nothing behind, while another organization's, a
 *     rewrite of the SSO provider itself, and one beside a provider being
 *     deleted are admitted;
 *   - a replace of a row that is gone is `missing`, and writes nothing;
 *   - a delete frees the provider's routes, and an unknown id resolves;
 *   - a provider marked as being deleted leaves the routing read
 *     (`findLive`) and the SSO read and is not live, while every other
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

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import {
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { IdentityProviderStore } from "./store.js";

/** The runner's fixture over this port. */
export type IdentityProviderStoreContractFixture = PortContractFixture<IdentityProviderStore>;

const AUDIENCE = "https://api.contract.test/stigmer";
const CREATED = timestampFromDate(new Date("2026-09-01T00:00:00Z"));

function provider(fields: {
  id: string;
  org: string;
  slug: string;
  issuers: ReadonlyArray<string>;
  audience?: string;
  displayName?: string;
  sso?: boolean;
}): IdentityProvider {
  const sso = fields.sso === true;
  return create(IdentityProviderSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityProvider",
    metadata: { id: fields.id, org: fields.org, slug: fields.slug, name: fields.slug },
    status: { audit: { specAudit: { createdAt: CREATED, updatedAt: CREATED } } },
    spec: {
      displayName: fields.displayName ?? fields.slug,
      allowedIssuers: [...fields.issuers],
      expectedAudience: fields.audience ?? AUDIENCE,
      isSsoProvider: sso,
      oidcClientId: sso ? `client-${fields.slug}` : "",
    },
  });
}

const CASES: ReadonlyArray<PortContractDeclaration<IdentityProviderStore>> = [
  [
    "a provider not fully shaped is refused on insert and replace, and nothing is written",
    async ({ store }) => {
      const unslugged = provider({ id: "idp_c0", org: "acme", slug: "", issuers: ["https://unshaped.contract.test"] });
      await assert.rejects(store.insert(unslugged), "an insert without a slug is refused");
      const unaudited = provider({ id: "idp_c0", org: "acme", slug: "unshaped", issuers: ["https://unshaped.contract.test"] });
      unaudited.status = undefined;
      await assert.rejects(store.insert(unaudited), "an insert without its audit is refused");
      assert.equal(await store.findById("idp_c0"), undefined);
      assert.equal(await store.findProviderIdByRoute("https://unshaped.contract.test", AUDIENCE), undefined);
      await store.insert(provider({ id: "idp_c0b", org: "acme", slug: "shaped", issuers: ["https://shaped.contract.test"] }));
      const reshaped = provider({ id: "idp_c0b", org: "acme", slug: "shaped", issuers: ["https://shaped.contract.test"] });
      reshaped.status = undefined;
      await assert.rejects(store.replace(reshaped), "a replace without its audit is refused");
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
        await store.replace(
          provider({ id: "idp_c17", org: "acme", slug: "twice", issuers: [...twice, "https://more.contract.test", "https://more.contract.test"] }),
        ),
        { kind: "replaced" },
      );
      assert.equal(await store.findProviderIdByRoute("https://more.contract.test", AUDIENCE), "idp_c17");
    },
  ],
  [
    "a replace rewrites the payload and the routes; a route another provider holds is route-taken and writes nothing",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c10", org: "acme", slug: "held", issuers: ["https://held.contract.test"] }));
      await store.insert(provider({ id: "idp_c11", org: "beta", slug: "moving", issuers: ["https://before.contract.test"] }));
      assert.deepEqual(
        await store.replace(provider({ id: "idp_c11", org: "beta", slug: "moving", issuers: ["https://after.contract.test"], displayName: "moved" })),
        { kind: "replaced" },
      );
      assert.equal((await store.findById("idp_c11"))?.spec?.displayName, "moved");
      assert.equal(await store.findProviderIdByRoute("https://after.contract.test", AUDIENCE), "idp_c11");
      assert.equal(await store.findProviderIdByRoute("https://before.contract.test", AUDIENCE), undefined, "a replaced route is released");
      assert.deepEqual(
        await store.replace(provider({ id: "idp_c11", org: "beta", slug: "moving", issuers: ["https://held.contract.test"], displayName: "grabbed" })),
        { kind: "route-taken", route: { issuer: "https://held.contract.test", audience: AUDIENCE } },
      );
      assert.equal((await store.findById("idp_c11"))?.spec?.displayName, "moved", "a refused replace writes nothing");
      assert.equal(await store.findProviderIdByRoute("https://after.contract.test", AUDIENCE), "idp_c11", "and keeps the routes it held");
    },
  ],
  [
    "a second live SSO provider in an organization is sso-taken on insert and writes nothing, while another organization's is admitted",
    async ({ store }) => {
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c21", org: "acme", slug: "first-sso", issuers: ["https://first-sso.contract.test"], sso: true })),
        { kind: "inserted" },
      );
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c22", org: "acme", slug: "second-sso", issuers: ["https://second-sso.contract.test"], sso: true })),
        { kind: "sso-taken" },
      );
      assert.equal(await store.findById("idp_c22"), undefined, "a refused insert writes nothing");
      assert.equal(
        await store.findProviderIdByRoute("https://second-sso.contract.test", AUDIENCE),
        undefined,
        "and claims no route",
      );
      assert.equal((await store.findSsoProviderByOrg("acme"))?.metadata?.id, "idp_c21");
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c23", org: "beta", slug: "beta-sso", issuers: ["https://beta-sso.contract.test"], sso: true })),
        { kind: "inserted" },
        "another organization holds its own",
      );
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c24", org: "acme", slug: "plain", issuers: ["https://plain.contract.test"] })),
        { kind: "inserted" },
        "a provider that is not SSO is never refused for it",
      );
    },
  ],
  [
    "a replace that makes a provider SSO beside a live SSO provider is sso-taken and writes nothing; the SSO provider's own rewrite is admitted",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c25", org: "acme", slug: "the-sso", issuers: ["https://the-sso.contract.test"], sso: true }));
      await store.insert(provider({ id: "idp_c26", org: "acme", slug: "plain", issuers: ["https://plain-before.contract.test"] }));
      assert.deepEqual(
        await store.replace(
          provider({ id: "idp_c26", org: "acme", slug: "plain", issuers: ["https://plain-after.contract.test"], sso: true }),
        ),
        { kind: "sso-taken" },
      );
      const kept = await store.findById("idp_c26");
      assert.equal(kept?.spec?.isSsoProvider, false, "a refused replace writes nothing");
      assert.equal(await store.findProviderIdByRoute("https://plain-before.contract.test", AUDIENCE), "idp_c26");
      assert.equal(await store.findProviderIdByRoute("https://plain-after.contract.test", AUDIENCE), undefined);
      assert.deepEqual(
        await store.replace(
          provider({ id: "idp_c25", org: "acme", slug: "the-sso", issuers: ["https://the-sso.contract.test"], sso: true, displayName: "renamed" }),
        ),
        { kind: "replaced" },
      );
      assert.equal((await store.findById("idp_c25"))?.spec?.displayName, "renamed");
    },
  ],
  [
    "an SSO provider being deleted leaves its organization's SSO place free for a new one",
    async ({ store }) => {
      await store.insert(provider({ id: "idp_c27", org: "acme", slug: "old-sso", issuers: ["https://old-sso.contract.test"], sso: true }));
      await store.markDeleting("idp_c27");
      assert.deepEqual(
        await store.insert(provider({ id: "idp_c28", org: "acme", slug: "new-sso", issuers: ["https://new-sso.contract.test"], sso: true })),
        { kind: "inserted" },
      );
      assert.equal((await store.findSsoProviderByOrg("acme"))?.metadata?.id, "idp_c28");
    },
  ],
  [
    "a replace of a row that is gone is missing, and writes nothing",
    async ({ store }) => {
      assert.deepEqual(
        await store.replace(provider({ id: "idp_c12", org: "acme", slug: "ghost", issuers: ["https://ghost.contract.test"] })),
        { kind: "missing" },
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
    "a provider being deleted leaves the routing and SSO reads and is not live, while every other read still answers it and its routes stay claimed",
    async ({ store }) => {
      const sso = provider({ id: "idp_c18", org: "acme", slug: "leaving", issuers: ["https://leaving.contract.test"] });
      if (sso.spec !== undefined) {
        sso.spec.isSsoProvider = true;
        sso.spec.oidcClientId = "client-leaving";
      }
      await store.insert(sso);
      await store.insert(provider({ id: "idp_c19", org: "acme", slug: "staying", issuers: ["https://staying.contract.test"] }));
      assert.equal(await store.isLive("idp_c18"), true);
      assert.equal((await store.findSsoProviderByOrg("acme"))?.metadata?.id, "idp_c18");

      await store.markDeleting("idp_c18");

      assert.equal(await store.isLive("idp_c18"), false);
      assert.equal(await store.isLive("idp_c19"), true, "the mark is the one provider's");
      assert.deepEqual((await store.findLive()).map((live) => live.metadata?.id), ["idp_c19"]);
      assert.equal(await store.findSsoProviderByOrg("acme"), undefined, "a provider being deleted answers no SSO discovery");
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
      await assert.rejects(store.findAll());
      await assert.rejects(store.findLive());
      await assert.rejects(store.isLive("idp_any"), "an outage never reads as 'not live'");
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function identityProviderStoreContract(
  makeFixture: () => Promise<IdentityProviderStoreContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(CASES, makeFixture);
}
