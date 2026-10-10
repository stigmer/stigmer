/**
 * Runs the IdentityAccountStore port-contract kit (../store-contract.ts)
 * over the OSS adapter (../resource-store.ts) on both drivers through the
 * drivers' own fixtures (sqlite always; Postgres under TEST_DATABASE_URL,
 * the store contract's gating), and pins the behaviors that are the OSS
 * adapter's rather than the port's:
 *
 *   - every subject lookup is a PRIMARY-KEY read of the derived id — it
 *     never calls Store.findByField or findAllByField (no per-request
 *     scan), the federated sign-in's lookup included. Asserted with a spy
 *     over the real store, not by inspection; findDirectByEmail and
 *     findByProvider are the lookups that scan (an administrative RPC and
 *     a provider's removal), each reading every matching row;
 *   - save refuses a direct account whose id is not its derived id, and a
 *     federated account whose id is not the address of its provider and
 *     subject — the invariants that make the primary-key reads correct,
 *     since a stray row would be unreachable by its natural key forever;
 *   - a lookup handed the federated address text itself as a subject
 *     still answers nothing: the mode filter stands behind the reserved
 *     prefix.
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
import {
  FEDERATED_SUBJECT_PREFIX,
  accountIdFor,
  federatedAccountIdFor,
} from "../constants.js";
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
  "no subject lookup answers a federated account: its subject is its identity provider's",
  "findByProviderAndIdpId finds a federated row by its provider and subject, and nothing under another provider or subject",
  "findByProviderAndIdpId keeps two providers' same subject apart, and never answers a direct row sharing the subject",
  "findByProvider answers every row the provider vouches for, in id order, and none of another provider's or a direct row",
  "an outage is a fault on both federated reads, never 'no account'",
  "findDirectByEmail answers the direct account when federated and platform-client rows share its email",
  "findDirectByIdpId and findDirectByEmail never answer a platform-client account, while findByIdpId (any mode) does",
  "findDirectByIdpId and findDirectByEmail never answer a service account, while findByIdpId (any mode) and findByOrg do",
  "findByOrg answers the accounts whose row names the organization, and never a person's own",
  "findByIds answers one row per distinct id, in first-occurrence order; an empty request answers an empty list",
  "update of an unknown id is a no-op: no row appears",
  "deleteById of an unknown id resolves",
  "save refuses a direct account with an empty idp_id",
  "save and update refuse an account whose provider ref and federated mode disagree; a row with neither saves",
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

const PROVIDER_ORG = "org_01hzacme000000000000000000";

/** A federated account at the address of its provider and subject, as the create path writes it. */
function makeFederatedAccount(idpId: string): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: {
      id: federatedAccountIdFor(PROVIDER_ORG, "acme-okta", idpId),
      name: idpId,
      org: PROVIDER_ORG,
    },
    spec: {
      idpId,
      provisioningMode: IdentityAccountProvisioningMode.federated,
      identityProviderRef: {
        org: PROVIDER_ORG,
        kind: ApiResourceKind.identity_provider,
        slug: "acme-okta",
      },
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
      // Every findByField and findAllByField call the adapter makes, by
      // field path — the spies that prove the hot paths are primary-key
      // reads.
      let findByFieldPaths: string[];
      let findAllByFieldPaths: string[];

      beforeEach(async () => {
        opened = await fixture.open();
        findByFieldPaths = [];
        findAllByFieldPaths = [];
        const spied: Store = Object.create(opened.store, {
          findByField: {
            value: (...args: Parameters<Store["findByField"]>) => {
              findByFieldPaths.push(args[1]);
              return opened.store.findByField(...args);
            },
          },
          findAllByField: {
            value: (...args: Parameters<Store["findAllByField"]>) => {
              findAllByFieldPaths.push(args[1]);
              return opened.store.findAllByField(...args);
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
        expect(findAllByFieldPaths).toEqual([]);
      });

      it("the federated sign-in's lookup is a primary-key read of the provider-and-subject address", async () => {
        await accounts.save(makeFederatedAccount("okta|dana"));
        expect(
          (
            await accounts.findByProviderAndIdpId(
              PROVIDER_ORG,
              "acme-okta",
              "okta|dana",
            )
          )?.metadata?.id,
        ).toBe(federatedAccountIdFor(PROVIDER_ORG, "acme-okta", "okta|dana"));
        expect(
          await accounts.findByProviderAndIdpId(
            PROVIDER_ORG,
            "acme-okta",
            "okta|nobody",
          ),
        ).toBeUndefined();
        expect(findByFieldPaths).toEqual([]);
        expect(findAllByFieldPaths).toEqual([]);
      });

      it("findByProvider scans by the provider's slug (a provider's removal, never a per-request path)", async () => {
        await accounts.save(makeFederatedAccount("okta|dana"));
        expect(
          (await accounts.findByProvider(PROVIDER_ORG, "acme-okta")).map(
            (account) => account.spec?.idpId,
          ),
        ).toEqual(["okta|dana"]);
        expect(findAllByFieldPaths).toEqual([
          "spec.identity_provider_ref.slug",
        ]);
      });

      it("refuses to save a federated account whose id is not the address of its provider and subject", async () => {
        const atDirectAddress = makeFederatedAccount("okta|erin");
        atDirectAddress.metadata = create(ApiResourceMetadataSchema, {
          id: accountIdFor("okta|erin"),
          name: "stray",
          org: PROVIDER_ORG,
        });
        await expect(accounts.save(atDirectAddress)).rejects.toThrow(
          "federated account id must be derived from its identity provider and idp_id",
        );
        expect(
          await opened.store.listResources(ApiResourceKind.identity_account),
        ).toHaveLength(0);
      });

      it("a federated read with a part no reference can hold answers nothing, and a save of a row with one is refused", async () => {
        await accounts.save(makeFederatedAccount("okta|dana"));
        for (const [org, slug, subject] of [
          ["", "acme-okta", "okta|dana"],
          [PROVIDER_ORG, "", "okta|dana"],
          [PROVIDER_ORG, "acme-okta", ""],
          [PROVIDER_ORG, "acme|okta", "dana"],
        ] as const) {
          expect(
            await accounts.findByProviderAndIdpId(org, slug, subject),
          ).toBeUndefined();
        }
        expect(await accounts.findByProvider("", "acme-okta")).toEqual([]);
        expect(await accounts.findByProvider(PROVIDER_ORG, "")).toEqual([]);

        const unaddressable = makeFederatedAccount("okta|erin");
        unaddressable.spec!.identityProviderRef!.org = "";
        await expect(accounts.save(unaddressable)).rejects.toThrow(
          "federated account id must be derived from its identity provider and idp_id",
        );
      });

      it("a subject lookup handed the federated address text answers nothing: the mode filter stands behind the reserved prefix", async () => {
        await accounts.save(makeFederatedAccount("okta|dana"));
        const addressText = `${FEDERATED_SUBJECT_PREFIX}${PROVIDER_ORG}|acme-okta|okta|dana`;
        expect(await accounts.findByIdpId(addressText)).toBeUndefined();
        expect(await accounts.findDirectByIdpId(addressText)).toBeUndefined();
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
        expect(findAllByFieldPaths).toEqual(["spec.email", "spec.email"]);
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
