/**
 * Runs the PlatformClientStore port-contract kit (../store-contract.ts) over
 * the OSS adapter (../resource-store.ts) on both drivers through the
 * drivers' own fixtures (sqlite always; Postgres under TEST_DATABASE_URL),
 * and pins how a lookup by slug reaches it (steps.ts findClientByName): a
 * name read in the name table, then this adapter by id, so a slug the
 * create chain never claimed resolves to nothing and an empty organization
 * is the platform's scope rather than every organization; a client holds
 * its name while the port finds its row.
 *
 * The kit's case list is pinned by name here so a case cannot drop out of
 * the kit unnoticed: the cloud driver's test iterates the same export and
 * would silently prove less.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import type { Store } from "../../../store/interface.js";
import { PostgresStore } from "../../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../../store/postgres/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { newResourcePlatformClientStore } from "../resource-store.js";
import { findClientByName, platformClientNameHolder } from "../steps.js";
import type { PlatformClientStoreContractFixture } from "../store-contract.js";
import { platformClientStoreContract } from "../store-contract.js";

/** The kit's contract lines, pinned: a dropped or renamed case is a visible diff here. */
const CONTRACT_CASE_NAMES = [
  "save then findById and findByClientId answer the saved client",
  "lookups of a client that is not held answer undefined",
  "save under a held id raises DuplicatePlatformClientError",
  "save under a held client_id raises DuplicatePlatformClientError",
  "the same slug in another organization is a different client",
  "update replaces the row in place",
  "update of an unknown id writes nothing",
  "modifyById persists what modify did, answers the persisted row, and the lookups follow it",
  "modifyById of an unknown id answers undefined and writes nothing",
  "a modify that throws writes nothing and rejects with its error",
  "concurrent modifyById calls on one row lose no write",
  "deleteById frees the id, the client_id and the slug; deleting an unknown id resolves",
  "findByOrg answers every client of the organization and no other",
  "a disconnected store is an infrastructure fault, never 'not found'",
] as const;

interface OpenedStore {
  readonly store: Store;
  close(): Promise<void>;
}

interface DriverFixture {
  readonly name: string;
  readonly skip: boolean;
  open(): Promise<OpenedStore>;
}

const sqliteFixture: DriverFixture = {
  name: "sqlite",
  skip: false,
  async open() {
    const temp = tempStore();
    return { store: temp.store, close: () => temp.cleanup() };
  },
};

let postgresDatabase: TestDatabase | undefined;
const postgresFixture: DriverFixture = {
  name: "postgres",
  skip: testDatabaseAdminUrl() === undefined,
  async open() {
    if (postgresDatabase === undefined) {
      postgresDatabase = await createTestDatabase();
    }
    const store = await PostgresStore.open(postgresDatabase.databaseUrl);
    await store.deleteResourcesByKind(ApiResourceKind.platform_client);
    return { store, close: () => store.close() };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.each([sqliteFixture, postgresFixture])(
  "PlatformClientStore over the OSS adapter ($name)",
  (fixture) => {
    describe.skipIf(fixture.skip)("the port-contract kit", () => {
      const cases = platformClientStoreContract(
        async (): Promise<PlatformClientStoreContractFixture> => {
          const opened = await fixture.open();
          return {
            store: newResourcePlatformClientStore(opened.store),
            disconnect: () => opened.store.close(),
            cleanup: () => opened.close(),
          };
        },
      );

      it("carries every contract line, by name", () => {
        expect(cases.map((contractCase) => contractCase.name)).toEqual(
          CONTRACT_CASE_NAMES,
        );
      });

      for (const contractCase of cases) {
        it(contractCase.name, contractCase.run);
      }
    });

    describe.skipIf(fixture.skip)("the OSS adapter's own invariants", () => {
      it("a slug resolves through the name table only: an unclaimed slug misses, an empty organization matches no organization's client", async () => {
        const opened = await fixture.open();
        try {
          const clients = newResourcePlatformClientStore(opened.store);
          const now = new Date().toISOString();
          await clients.save(
            create(PlatformClientSchema, {
              metadata: {
                id: "pcl_acme_dashboard",
                org: "acme",
                slug: "dashboard",
                name: "d",
              },
              spec: { clientId: "stgm_cid_acme_dashboard" },
            }),
          );
          expect(
            await findClientByName(opened.store, clients, "acme", "dashboard"),
          ).toBeUndefined();
          await opened.store.resourceNames.claim(
            { kind: "platform_client", org: "acme", name: "dashboard" },
            "pcl_acme_dashboard",
            now,
          );
          expect(
            (await findClientByName(opened.store, clients, "acme", "dashboard"))
              ?.metadata?.id,
          ).toBe("pcl_acme_dashboard");
          expect(
            await findClientByName(opened.store, clients, "globex", "dashboard"),
          ).toBeUndefined();
          const entry = {
            kind: "platform_client",
            org: "acme",
            name: "dashboard",
            state: "current" as const,
            claimedAt: now,
            expiresAt: "",
          };
          const holder = platformClientNameHolder(clients);
          expect(await holder.holds({ ...entry, id: "pcl_acme_dashboard" })).toBe(true);
          expect(await holder.holds({ ...entry, id: "pcl_gone" })).toBe(false);
          expect(
            await findClientByName(opened.store, clients, "", "dashboard"),
            "an empty organization is the platform's scope, never every organization",
          ).toBeUndefined();
        } finally {
          await opened.close();
        }
      });
    });
  },
);
