/**
 * Pins the IdentityAccountStore PORT over the OSS adapter
 * (resource-store.ts), on both drivers through the drivers' own fixtures
 * (sqlite always; Postgres under TEST_DATABASE_URL, the store contract's
 * gating). The port is cut from the cloud's store interface to its direct
 * subset (T01_0_plan.md §3a); the adapter's contract, per A1:
 *
 *   - save is create-only in effect: a second save under a held idp_id is
 *     DuplicateAccountError, never a silent overwrite;
 *   - findDirectByIdpId is a PRIMARY-KEY read of the derived id — it never
 *     calls Store.findByField (the per-request scan A1 removed). Asserted
 *     with a spy over the real store, not by inspection;
 *   - every direct account in the OSS store is addressable by its derived
 *     id — the invariant that makes the primary-key read correct;
 *   - findDirectByEmail stays a findByField scan (an administrative
 *     lookup, recorded in T01_1_review.md finding 2);
 *   - the ratified store-fault mapping: a typed not-found reads as
 *     undefined; any other store failure propagates.
 *
 * The cloud driver runs the same cases in S3; how the cases reach it is an
 * S3 question recorded in T01_3_execution.md.
 */
import { create } from "@bufbuild/protobuf";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

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
import { DuplicateAccountError } from "../store.js";
import type { IdentityAccountStore } from "../store.js";

/** A direct account as the domain writes it: id derived, mode direct. */
function makeDirectAccount(overrides: {
  idpId: string;
  email?: string;
  firstName?: string;
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
      firstName: overrides.firstName ?? "",
      provisioningMode: IdentityAccountProvisioningMode.direct,
    },
  });
}

interface DriverFixture {
  readonly name: string;
  readonly skip: boolean;
  open(): Promise<{ store: Store; close(): Promise<void> }>;
}

const sqliteFixture: DriverFixture = {
  name: "sqlite",
  skip: false,
  async open() {
    const temp = tempStore();
    return {
      store: temp.store,
      async close() {
        temp.cleanup();
      },
    };
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
    return {
      store,
      async close() {
        await store.close();
      },
    };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.each([sqliteFixture, postgresFixture])(
  "IdentityAccountStore over the OSS adapter ($name)",
  (fixture) => {
    describe.skipIf(fixture.skip)("port contract", () => {
      let opened: { store: Store; close(): Promise<void> };
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

      it("save then findById round-trips the account bytes", async () => {
        const account = makeDirectAccount({
          idpId: "auth0|alice",
          email: "alice@example.com",
        });
        await accounts.save(account);
        const found = await accounts.findById(account.metadata?.id ?? "");
        expect(found).toEqual(account);
      });

      it("a second save under a held idp_id is DuplicateAccountError, and the first row stands", async () => {
        const first = makeDirectAccount({
          idpId: "auth0|bob",
          firstName: "First",
        });
        const second = makeDirectAccount({
          idpId: "auth0|bob",
          firstName: "Second",
        });
        await accounts.save(first);
        await expect(accounts.save(second)).rejects.toBeInstanceOf(
          DuplicateAccountError,
        );
        expect(
          (await accounts.findDirectByIdpId("auth0|bob"))?.spec?.firstName,
        ).toBe("First");
      });

      it("findDirectByIdpId is a primary-key read — never a findByField scan", async () => {
        await accounts.save(makeDirectAccount({ idpId: "auth0|carol" }));
        const hit = await accounts.findDirectByIdpId("auth0|carol");
        expect(hit?.metadata?.id).toBe(accountIdFor("auth0|carol"));
        expect(
          await accounts.findDirectByIdpId("auth0|nobody"),
        ).toBeUndefined();
        expect(findByFieldPaths).toEqual([]);
      });

      it("findByIdpId (any mode) answers the same row in open source, also by primary key", async () => {
        await accounts.save(makeDirectAccount({ idpId: "auth0|dave" }));
        expect((await accounts.findByIdpId("auth0|dave"))?.spec?.idpId).toBe(
          "auth0|dave",
        );
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
          await accounts.findDirectByEmail("ERIN@example.com"),
        ).toBeUndefined();
        expect(
          await accounts.findDirectByEmail("nobody@example.com"),
        ).toBeUndefined();
        expect(findByFieldPaths).toEqual([
          "spec.email",
          "spec.email",
          "spec.email",
        ]);
      });

      it("update replaces the row in place and keeps the id", async () => {
        const account = makeDirectAccount({
          idpId: "auth0|frank",
          firstName: "Frank",
        });
        await accounts.save(account);
        const edited = makeDirectAccount({
          idpId: "auth0|frank",
          firstName: "Francis",
        });
        await accounts.update(edited);
        expect(
          (await accounts.findById(account.metadata?.id ?? ""))?.spec
            ?.firstName,
        ).toBe("Francis");
      });

      it("deleteById removes the row; the subject is free to be provisioned again", async () => {
        const account = makeDirectAccount({ idpId: "auth0|grace" });
        await accounts.save(account);
        await accounts.deleteById(account.metadata?.id ?? "");
        expect(
          await accounts.findById(account.metadata?.id ?? ""),
        ).toBeUndefined();
        expect(await accounts.findDirectByIdpId("auth0|grace")).toBeUndefined();
        await expect(accounts.save(account)).resolves.toBeUndefined();
      });

      it("findByIds answers the present ones in request order and skips the unknown", async () => {
        const a = makeDirectAccount({ idpId: "auth0|heidi" });
        const b = makeDirectAccount({ idpId: "auth0|ivan" });
        await accounts.save(a);
        await accounts.save(b);
        const found = await accounts.findByIds([
          b.metadata?.id ?? "",
          "ida_00000000000000000000000000",
          a.metadata?.id ?? "",
        ]);
        expect(found.map((account) => account.spec?.idpId)).toEqual([
          "auth0|ivan",
          "auth0|heidi",
        ]);
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
      });

      it("a closed store is an infrastructure fault, never 'not found'", async () => {
        await opened.close();
        await expect(
          accounts.findDirectByIdpId("auth0|anyone"),
        ).rejects.toThrow();
        // Re-open so afterEach's close is a no-op on a live handle.
        opened = await fixture.open();
      });
    });
  },
);

describe("the adapter over the sqlite driver — concurrency", () => {
  let opened: { store: Store; close(): Promise<void> };

  beforeAll(async () => {
    opened = await sqliteFixture.open();
  });

  afterAll(async () => {
    await opened.close();
  });

  it("two concurrent saves of one subject leave exactly one row and one winner", async () => {
    const accounts = newResourceIdentityAccountStore(opened.store);
    const results = await Promise.allSettled([
      accounts.save(makeDirectAccount({ idpId: "auth0|race", firstName: "A" })),
      accounts.save(makeDirectAccount({ idpId: "auth0|race", firstName: "B" })),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const duplicates = results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof DuplicateAccountError,
    );
    // Either both interleave to one winner and one duplicate, or the
    // primary key makes the second an idempotent overwrite of identical
    // shape — never two rows, never a foreign error.
    expect(fulfilled.length + duplicates.length).toBe(2);
    const rows = await opened.store.listResources(
      ApiResourceKind.identity_account,
    );
    expect(rows).toHaveLength(1);
    expect((await accounts.findDirectByIdpId("auth0|race"))?.metadata?.id).toBe(
      accountIdFor("auth0|race"),
    );
  });
});
