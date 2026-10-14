/**
 * The IdentityProvider row store over the real `ee.iam_identity_provider`
 * and route side table, through the real Enterprise schema chain (one throwaway
 * database for the file). Pins what the in-memory store the unit suites
 * use promises in its name:
 *   - insert then read round-trips the proto and claims its routes, each
 *     issuer with the audience; a slug the organization holds is
 *     `slug-taken`, the same slug in another organization is not; a route
 *     another provider claims is `route-taken`, and the refused insert
 *     leaves no row and no claim; the same issuer with another audience is
 *     another route, and is admitted; a provider with no audience claims
 *     no route;
 *   - a unique violation that is no claim (the id's primary key) is not
 *     misread as one: it fails as the fault it is;
 *   - replace rewrites the payload and the route claims and
 *     keeps the lookup columns; a claimed route rolls the whole replace
 *     back; a row that is gone is `missing`, and nothing is written;
 *   - pageByOrg is newest first, findIdsByOrg every one; deleteById
 *     removes the row and its claims, and an unknown id resolves.
 *
 * Then the port's contract kit (../store-contract.ts) over this adapter, on
 * a database of its own with a fresh pool per case over truncated tables,
 * so the kit's outage arm can end that pool alone: the same cases the
 * in-memory store passes in in-memory-provider-store.test.ts.
 *
 * TEST_DATABASE_URL unset skips loudly by suite name (stigmer's
 * `make postgres-dev` prints the export).
 */
import { clone, fromBinary } from "@bufbuild/protobuf";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../../__test-utils__/enterprise-postgres.js";
import { federationIssuerStoreContract, type FederationIssuerStoreContractFixture } from "../store-contract.js";
import { newFederationIssuerStore } from "../postgres-store.js";
import type { FederationIssuerStore, ProviderSwapOutcome } from "../store.js";
import { storedProvider } from "./in-memory-provider-store.js";

/** The audience the claim cases share, so an issuer alone decides whether routes collide. */
const AUDIENCE = "https://api.test/stigmer";

/** An organization's whole list, in its order. */
async function listed(store: FederationIssuerStore, org: string): Promise<FederationIssuer[]> {
  return (await store.pageByOrg(org, undefined, undefined)).map((row) =>
    fromBinary(FederationIssuerSchema, row.data),
  );
}

describe.skipIf(!TEST_DATABASE_URL)("the IdentityProvider store over ee.iam_identity_provider", () => {
  let database: ProvisionedEnterpriseDatabase;
  let store: FederationIssuerStore;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
    store = newFederationIssuerStore(database.pool);
  });

  afterAll(async () => {
    await database?.drop();
  });

  /** The update's write: a swap on the provider's bytes as stored now; a row that is gone swaps on none. */
  async function swapOnCurrent(next: FederationIssuer): Promise<ProviderSwapOutcome> {
    const id = next.metadata?.id ?? "";
    const read = await store.readForWrite(id);
    return store.swap(id, read?.bytes ?? new Uint8Array(), next);
  }

  it("round-trips a provider and refuses a slug its organization holds, not one another holds", async () => {
    const provider = storedProvider({
      id: "idp_rt",
      org: "acme",
      slug: "rt",
      issuers: ["https://rt.test"],
      expectedAudience: AUDIENCE,
    });
    expect(await store.insert(provider)).toEqual({ kind: "inserted" });
    expect(await store.findById("idp_rt")).toEqual(provider);
    expect(await store.findProviderIdByRoute("https://rt.test", AUDIENCE)).toBe("idp_rt");
    expect(await store.findProviderIdByRoute("https://rt.test", "https://another.test")).toBeUndefined();

    expect(
      await store.insert(
        storedProvider({ id: "idp_rt2", org: "acme", slug: "rt", issuers: ["https://rt2.test"], expectedAudience: AUDIENCE }),
      ),
    ).toEqual({ kind: "slug-taken" });
    expect(await store.findProviderIdByRoute("https://rt2.test", AUDIENCE)).toBeUndefined();
    expect(
      await store.insert(storedProvider({ id: "idp_rt3", org: "other", slug: "rt", issuers: ["https://rt3.test"] })),
    ).toEqual({ kind: "inserted" });
  });

  it("refuses a route another provider claims and writes nothing", async () => {
    await store.insert(
      storedProvider({ id: "idp_i1", org: "acme", slug: "i1", issuers: ["https://shared.test"], expectedAudience: AUDIENCE }),
    );

    expect(
      await store.insert(
        storedProvider({
          id: "idp_i2",
          org: "other",
          slug: "i2",
          issuers: ["https://own.test", "https://shared.test"],
          expectedAudience: AUDIENCE,
        }),
      ),
    ).toEqual({ kind: "route-taken", route: { issuer: "https://shared.test", audience: AUDIENCE } });
    expect(await store.findById("idp_i2")).toBeUndefined();
    expect(await store.findProviderIdByRoute("https://own.test", AUDIENCE)).toBeUndefined();
  });

  it("admits the same issuer with another audience, and claims no route for a provider with no audience", async () => {
    await store.insert(
      storedProvider({ id: "idp_a1", org: "first", slug: "a1", issuers: ["https://common.test"], expectedAudience: AUDIENCE }),
    );
    expect(
      await store.insert(
        storedProvider({
          id: "idp_a2",
          org: "second",
          slug: "a2",
          issuers: ["https://common.test"],
          expectedAudience: "https://second.test/stigmer",
        }),
      ),
    ).toEqual({ kind: "inserted" });
    expect(await store.findProviderIdByRoute("https://common.test", AUDIENCE)).toBe("idp_a1");
    expect(await store.findProviderIdByRoute("https://common.test", "https://second.test/stigmer")).toBe("idp_a2");

    expect(
      await store.insert(
        storedProvider({ id: "idp_a3", org: "third", slug: "a3", issuers: ["https://common.test"], expectedAudience: "" }),
      ),
    ).toEqual({ kind: "inserted" });
    expect(await store.findProviderIdByRoute("https://common.test", "")).toBeUndefined();
  });

  it("fails an insert whose id is already held rather than answering a claim", async () => {
    await store.insert(storedProvider({ id: "idp_dup", org: "acme", slug: "dup-1", issuers: [] }));

    await expect(
      store.insert(storedProvider({ id: "idp_dup", org: "acme", slug: "dup-2", issuers: [] })),
    ).rejects.toMatchObject({ code: "23505" });
    expect((await listed(store, "acme")).map((held) => held.metadata?.slug)).not.toContain("dup-2");
  });

  it("swaps the payload and the route claims, keeps the lookup columns, and refuses a slug change", async () => {
    const provider = storedProvider({
      id: "idp_rp",
      org: "acme",
      slug: "rp",
      issuers: ["https://before.test"],
      expectedAudience: AUDIENCE,
    });
    await store.insert(provider);
    const renamed = clone(FederationIssuerSchema, provider);
    renamed.metadata!.slug = "moved";
    await expect(swapOnCurrent(renamed), "a slug moves only by rename").rejects.toThrow(/keeps a provider's slug/);
    const changed = clone(FederationIssuerSchema, provider);
    changed.metadata!.name = "After";
    changed.spec!.allowedIssuers = ["https://after.test"];

    expect(await swapOnCurrent(changed)).toEqual({ kind: "replaced" });
    expect((await store.findById("idp_rp"))?.metadata?.name).toBe("After");
    const columns = await database.pool.query<{ org: string; slug: string }>(
      "SELECT org, slug FROM ee.iam_identity_provider WHERE id = $1",
      ["idp_rp"],
    );
    expect(columns.rows, "the lookup columns are kept").toEqual([{ org: "acme", slug: "rp" }]);
    expect(await store.findProviderIdByRoute("https://after.test", AUDIENCE)).toBe("idp_rp");
    expect(await store.findProviderIdByRoute("https://before.test", AUDIENCE)).toBeUndefined();
  });

  it("rolls a swap back when another provider claims a route", async () => {
    await store.insert(
      storedProvider({ id: "idp_c1", org: "claims", slug: "c1", issuers: ["https://c1.test"], expectedAudience: AUDIENCE }),
    );
    const second = storedProvider({
      id: "idp_c2",
      org: "claims",
      slug: "c2",
      issuers: ["https://c2.test"],
      expectedAudience: AUDIENCE,
    });
    await store.insert(second);
    const grabbing = clone(FederationIssuerSchema, second);
    grabbing.metadata!.name = "Grabbing";
    grabbing.spec!.allowedIssuers = ["https://c1.test"];

    expect(await swapOnCurrent(grabbing)).toEqual({
      kind: "route-taken",
      route: { issuer: "https://c1.test", audience: AUDIENCE },
    });
    expect((await store.findById("idp_c2"))?.metadata?.name).toBe("c2");
    expect(await store.findProviderIdByRoute("https://c2.test", AUDIENCE)).toBe("idp_c2");
  });

  it("answers changed for a swap of a row that is gone, and claims nothing", async () => {
    const ghost = storedProvider({
      id: "idp_ghost",
      org: "acme",
      slug: "ghost",
      issuers: ["https://ghost.test"],
      expectedAudience: AUDIENCE,
    });

    expect(await swapOnCurrent(ghost)).toEqual({ kind: "changed" });
    expect(await store.findById("idp_ghost")).toBeUndefined();
    expect(await store.findProviderIdByRoute("https://ghost.test", AUDIENCE)).toBeUndefined();
  });

  it("lists an organization's providers newest first, sweeps its ids, and deletes rows with their claims", async () => {
    await store.insert(
      storedProvider({
        id: "idp_l1",
        org: "listed",
        slug: "l1",
        issuers: ["https://l1.test"],
        expectedAudience: AUDIENCE,
        createdAt: new Date("2026-09-24T09:00:00Z"),
      }),
    );
    await store.insert(
      storedProvider({ id: "idp_l2", org: "listed", slug: "l2", issuers: ["https://l2.test"], createdAt: new Date("2026-09-24T11:00:00Z") }),
    );
    await store.insert(storedProvider({ id: "idp_o1", org: "elsewhere", slug: "o1", issuers: ["https://o1.test"] }));

    expect((await listed(store, "listed")).map((row) => row.metadata?.id)).toEqual(["idp_l2", "idp_l1"]);
    expect([...(await store.findIdsByOrg("listed"))].sort()).toEqual(["idp_l1", "idp_l2"]);

    await store.deleteById("idp_l1");
    await store.deleteById("idp_never");
    expect(await store.findById("idp_l1")).toBeUndefined();
    expect(await store.findProviderIdByRoute("https://l1.test", AUDIENCE)).toBeUndefined();
    expect((await listed(store, "listed")).map((row) => row.metadata?.id)).toEqual(["idp_l2"]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("the IdentityProvider store holds the port's contract (real Postgres)", () => {
  let database: ProvisionedEnterpriseDatabase;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });

  async function makeFixture(): Promise<FederationIssuerStoreContractFixture> {
    await database.pool.query("TRUNCATE ee.iam_identity_provider_route, ee.iam_identity_provider");
    const pool = new Pool({ connectionString: database.databaseUrl, max: 4 });
    let ended = false;
    const end = async (): Promise<void> => {
      if (!ended) {
        ended = true;
        await pool.end();
      }
    };
    return { store: newFederationIssuerStore(pool), disconnect: end, cleanup: end };
  }

  for (const contractCase of federationIssuerStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
