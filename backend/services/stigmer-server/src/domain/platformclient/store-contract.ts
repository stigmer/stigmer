/**
 * The PlatformClientStore PORT-CONTRACT KIT: every behavior an
 * implementation of store.ts must satisfy identically, as cases a driver's
 * test iterates. Open source runs them over its own adapter
 * (resource-store.ts) on sqlite and Postgres in
 * __tests__/resource-store.test.ts; a composition runs the SAME cases over
 * the store it registers as `drivers.platformClientStore` (the cloud's
 * `cloud.iam_platform_client` store), so "the port holds" is one statement
 * proven per driver, never restated per repository.
 *
 * Shape: declarations over the port-contract runner (store/port-contract.ts),
 * which owns the fresh fixture per case, the cleanup, and the reason the
 * kit returns cases instead of calling vitest's `describe`. The
 * disconnected-store case matters most here: the verifier reads this port
 * on every request a minted token bears, so an outage that read as "no
 * client" would revoke every live token instead of failing loudly.
 *
 * The duplicate arms check `instanceof DuplicatePlatformClientError` on the
 * exported class, because that is how the create chain's Persist step
 * catches it: a driver throwing a lookalike fails here for the reason it
 * would fail a create.
 *
 * Case names are the contract lines, in the port's words. The OSS test pins
 * the full list, so a case cannot drop out of the kit unnoticed.
 */
import assert from "node:assert/strict";

import { create, equals } from "@bufbuild/protobuf";

import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { portContractCases } from "../../store/port-contract.js";
import type {
  PortContractCase,
  PortContractDeclaration,
  PortContractFixture,
} from "../../store/port-contract.js";
import { DuplicatePlatformClientError } from "./store.js";
import type { PlatformClientStore } from "./store.js";

/** The runner's fixture over this port — the name a driver's test and the barrel know it by. */
export type PlatformClientStoreContractFixture =
  PortContractFixture<PlatformClientStore>;

export type PlatformClientStoreContractCase = PortContractCase;

/** A client as the domain writes it; each fixture names its own id, org, slug and client_id. */
function platformClient(fields: {
  id: string;
  org: string;
  slug: string;
  clientId: string;
  allowedOrigins?: string[];
}): PlatformClient {
  return create(PlatformClientSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "PlatformClient",
    metadata: {
      id: fields.id,
      name: fields.slug,
      slug: fields.slug,
      org: fields.org,
    },
    spec: {
      clientId: fields.clientId,
      clientSecretHash: `hash-of-${fields.clientId}`,
      secretFingerprint: "abcdef",
      autoProvisionAccounts: true,
      allowedOrigins: fields.allowedOrigins ?? [],
    },
  });
}

function assertSameClient(
  actual: PlatformClient | undefined,
  expected: PlatformClient,
  message: string,
): void {
  assert.ok(actual !== undefined, `${message}: no client was answered`);
  assert.ok(equals(PlatformClientSchema, actual, expected), message);
}

async function assertDuplicate(
  write: Promise<void>,
  message: string,
): Promise<void> {
  await assert.rejects(
    write,
    (error: unknown) => error instanceof DuplicatePlatformClientError,
    message,
  );
}

const ACME_DASHBOARD = platformClient({
  id: "pcl_contract_acme_dashboard",
  org: "acme",
  slug: "dashboard",
  clientId: "stgm_cid_contract_acme_dashboard",
});

const CASES: ReadonlyArray<PortContractDeclaration<PlatformClientStore>> = [
  [
    "save then findById, findByClientId and findByOrgAndSlug answer the saved client",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      assertSameClient(
        await store.findById("pcl_contract_acme_dashboard"),
        ACME_DASHBOARD,
        "findById must answer the saved row",
      );
      assertSameClient(
        await store.findByClientId("stgm_cid_contract_acme_dashboard"),
        ACME_DASHBOARD,
        "findByClientId must answer the saved row",
      );
      assertSameClient(
        await store.findByOrgAndSlug("acme", "dashboard"),
        ACME_DASHBOARD,
        "findByOrgAndSlug must answer the saved row",
      );
    },
  ],
  [
    "lookups of a client that is not held answer undefined",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      assert.equal(await store.findById("pcl_contract_nobody"), undefined);
      assert.equal(await store.findByClientId("stgm_cid_contract_nobody"), undefined);
      assert.equal(await store.findByOrgAndSlug("acme", "nobody"), undefined);
      assert.equal(
        await store.findByOrgAndSlug("globex", "dashboard"),
        undefined,
        "a slug is scoped to its organization: another org's lookup must miss",
      );
    },
  ],
  [
    "save under a held id raises DuplicatePlatformClientError",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      await assertDuplicate(
        store.save(
          platformClient({
            id: "pcl_contract_acme_dashboard",
            org: "acme",
            slug: "other",
            clientId: "stgm_cid_contract_other",
          }),
        ),
        "a held id must be refused, never overwritten",
      );
    },
  ],
  [
    "save under a held (org, slug) raises DuplicatePlatformClientError",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      await assertDuplicate(
        store.save(
          platformClient({
            id: "pcl_contract_acme_second",
            org: "acme",
            slug: "dashboard",
            clientId: "stgm_cid_contract_acme_second",
          }),
        ),
        "a held (org, slug) must be refused",
      );
    },
  ],
  [
    "save under a held client_id raises DuplicatePlatformClientError",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      await assertDuplicate(
        store.save(
          platformClient({
            id: "pcl_contract_acme_third",
            org: "acme",
            slug: "third",
            clientId: "stgm_cid_contract_acme_dashboard",
          }),
        ),
        "a held client_id must be refused: the mint resolves a client by it",
      );
    },
  ],
  [
    "the same slug in another organization is a different client",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      const globex = platformClient({
        id: "pcl_contract_globex_dashboard",
        org: "globex",
        slug: "dashboard",
        clientId: "stgm_cid_contract_globex_dashboard",
      });
      await store.save(globex);
      assertSameClient(
        await store.findByOrgAndSlug("globex", "dashboard"),
        globex,
        "each organization answers its own client for the shared slug",
      );
    },
  ],
  [
    "update replaces the row in place",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      const edited = platformClient({
        id: "pcl_contract_acme_dashboard",
        org: "acme",
        slug: "dashboard",
        clientId: "stgm_cid_contract_acme_dashboard",
        allowedOrigins: ["https://app.acme.example"],
      });
      await store.update(edited);
      assertSameClient(
        await store.findById("pcl_contract_acme_dashboard"),
        edited,
        "findById must answer the replaced row",
      );
      assertSameClient(
        await store.findByClientId("stgm_cid_contract_acme_dashboard"),
        edited,
        "findByClientId must answer the replaced row",
      );
    },
  ],
  [
    "update of an unknown id writes nothing",
    async ({ store }) => {
      await store.update(ACME_DASHBOARD);
      assert.equal(
        await store.findById("pcl_contract_acme_dashboard"),
        undefined,
        "update must replace, never create",
      );
    },
  ],
  [
    "deleteById frees the id, the client_id and the slug; deleting an unknown id resolves",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      await store.deleteById("pcl_contract_acme_dashboard");
      assert.equal(await store.findById("pcl_contract_acme_dashboard"), undefined);
      assert.equal(
        await store.findByClientId("stgm_cid_contract_acme_dashboard"),
        undefined,
        "a deleted client's client_id must stop resolving: the mint and the verifier read it",
      );
      assert.equal(await store.findByOrgAndSlug("acme", "dashboard"), undefined);
      await store.save(ACME_DASHBOARD);
      await store.deleteById("pcl_contract_nobody");
    },
  ],
  [
    "findByOrg answers every client of the organization and no other",
    async ({ store }) => {
      await store.save(ACME_DASHBOARD);
      await store.save(
        platformClient({
          id: "pcl_contract_acme_mobile",
          org: "acme",
          slug: "mobile",
          clientId: "stgm_cid_contract_acme_mobile",
        }),
      );
      await store.save(
        platformClient({
          id: "pcl_contract_globex_dashboard",
          org: "globex",
          slug: "dashboard",
          clientId: "stgm_cid_contract_globex_dashboard",
        }),
      );
      const ids = (await store.findByOrg("acme"))
        .map((client) => client.metadata?.id ?? "")
        .sort();
      assert.deepEqual(ids, ["pcl_contract_acme_dashboard", "pcl_contract_acme_mobile"]);
      assert.deepEqual(await store.findByOrg("initech"), []);
    },
  ],
  [
    "a disconnected store is an infrastructure fault, never 'not found'",
    async (fixture) => {
      await fixture.disconnect();
      await assert.rejects(
        fixture.store.findById("pcl_contract_acme_dashboard"),
        "an id read on a disconnected store must reject: on the verifier's path 'not found' revokes every token",
      );
      await assert.rejects(
        fixture.store.findByClientId("stgm_cid_contract_acme_dashboard"),
        "a client_id read on a disconnected store must reject, never read as undefined",
      );
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function platformClientStoreContract(
  makeFixture: () => Promise<PlatformClientStoreContractFixture>,
): ReadonlyArray<PlatformClientStoreContractCase> {
  return portContractCases(CASES, makeFixture);
}
