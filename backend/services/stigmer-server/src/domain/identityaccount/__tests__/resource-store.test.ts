/**
 * Runs the IdentityAccountStore port-contract kit (../store-contract.ts)
 * over the OSS adapter (../resource-store.ts) on both drivers through the
 * drivers' own fixtures (sqlite always; Postgres under TEST_DATABASE_URL,
 * the store contract's gating), and pins the two behaviors that are the
 * OSS adapter's rather than the port's (T01_1_review.md A1):
 *
 *   - every subject lookup is a PRIMARY-KEY read of the derived id — it
 *     never calls Store.findByField (the per-request scan A1 removed).
 *     Asserted with a spy over the real store, not by inspection;
 *     findDirectByEmail is the one lookup that scans (an administrative
 *     RPC, T01_1_review.md finding 2);
 *   - save refuses a direct account whose id is not its derived id — the
 *     invariant that makes the primary-key read correct, since a stray row
 *     would be unreachable by subject forever.
 *
 * The kit's case list is pinned by name here so a case cannot drop out of
 * the kit unnoticed: the cloud driver's test iterates the same export and
 * would silently prove less.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { Store } from "../../../store/interface.js";
import { PostgresStore } from "../../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../../store/postgres/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { accountIdFor } from "../constants.js";
import { newResourceIdentityAccountStore } from "../resource-store.js";
import type { IdentityAccountStoreContractFixture } from "../store-contract.js";
import { identityAccountStoreContract } from "../store-contract.js";
import type { IdentityAccountStore } from "../store.js";

/** The kit's contract lines, pinned: a dropped or renamed case is a visible diff here. */
const CONTRACT_CASE_NAMES = [
  "save then findById round-trips the account",
  "a second save under a held id is DuplicateAccountError, and the first row stands",
  "findDirectByIdpId answers a direct account by its subject and undefined for an unknown one",
  "findByIdpId (any mode) answers the same direct account",
  "findDirectByEmail is an exact, case-sensitive match on direct accounts",
  "update replaces the row in place and keeps the id",
  "deleteById removes the row; the subject is free to be provisioned again",
  "findByIds answers the present ones in request order and skips the unknown",
  "a disconnected store is an infrastructure fault, never 'not found'",
  "two concurrent saves of one subject end in fulfilments and DuplicateAccountErrors only, and the winner is readable by subject",
  "findDirectByIdpId and findDirectByEmail never answer a federated account, while findByIdpId (any mode) does",
  "findByIds answers one row per distinct id, in first-occurrence order; an empty request answers an empty list",
  "update of an unknown id is a no-op: no row appears",
  "deleteById of an unknown id resolves",
  "save refuses a direct account with an empty idp_id",
] as const;

/** A direct account as the domain writes it: id derived, mode direct. */
function makeDirectAccount(overrides: {
  idpId: string;
  email?: string;
}): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: {
      id: accountIdFor(overrides.idpId),
      name: overrides.email ?? overrides.idpId,
    },
    spec: {
      idpId: overrides.idpId,
      email: overrides.email ?? "",
      provisioningMode: IdentityAccountProvisioningMode.direct,
    },
  });
}

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
    await store.deleteResourcesByKind(ApiResourceKind.identity_account);
    return { store, close: () => store.close() };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.each([sqliteFixture, postgresFixture])(
  "IdentityAccountStore over the OSS adapter ($name)",
  (fixture) => {
    describe.skipIf(fixture.skip)("the port-contract kit", () => {
      const cases = identityAccountStoreContract(
        async (): Promise<IdentityAccountStoreContractFixture> => {
          const opened = await fixture.open();
          return {
            store: newResourceIdentityAccountStore(opened.store),
            // Both drivers' close is idempotent, so cleanup after a
            // disconnect is a no-op on the handle (plus the temp dir).
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
      let opened: OpenedStore;
      let accounts: IdentityAccountStore;
      // Every findByField call the adapter makes, by field path — the spy
      // that proves the hot path is a primary-key read.
      let findByFieldPaths: string[];

      beforeEach(async () => {
        opened = await fixture.open();
        findByFieldPaths = [];
        const spied: Store = Object.create(opened.store, {
          findByField: {
            value: (...args: Parameters<Store["findByField"]>) => {
              findByFieldPaths.push(args[1]);
              return opened.store.findByField(...args);
            },
          },
        }) as Store;
        accounts = newResourceIdentityAccountStore(spied);
      });

      afterEach(async () => {
        await opened.close();
      });

      it("every subject lookup is a primary-key read — never a findByField scan", async () => {
        await accounts.save(makeDirectAccount({ idpId: "auth0|carol" }));
        expect(
          (await accounts.findDirectByIdpId("auth0|carol"))?.metadata?.id,
        ).toBe(accountIdFor("auth0|carol"));
        expect((await accounts.findByIdpId("auth0|carol"))?.spec?.idpId).toBe(
          "auth0|carol",
        );
        expect(
          await accounts.findDirectByIdpId("auth0|nobody"),
        ).toBeUndefined();
        expect(findByFieldPaths).toEqual([]);
      });

      it("findDirectByEmail is the one lookup that scans (administrative, exact match)", async () => {
        await accounts.save(
          makeDirectAccount({ idpId: "auth0|erin", email: "erin@example.com" }),
        );
        expect(
          (await accounts.findDirectByEmail("erin@example.com"))?.spec?.idpId,
        ).toBe("auth0|erin");
        expect(
          await accounts.findDirectByEmail("nobody@example.com"),
        ).toBeUndefined();
        expect(findByFieldPaths).toEqual(["spec.email", "spec.email"]);
      });

      it("refuses to save a direct account whose id is not its derived id", async () => {
        const stray = makeDirectAccount({ idpId: "auth0|judy" });
        stray.metadata = create(ApiResourceMetadataSchema, {
          id: "ida_01hzzzzzzzzzzzzzzzzzzzzzzz",
          name: "stray",
        });
        await expect(accounts.save(stray)).rejects.toThrow(
          "direct account id must be derived from its idp_id",
        );
        expect(
          await opened.store.listResources(ApiResourceKind.identity_account),
        ).toHaveLength(0);
      });
    });
  },
);
