/**
 * Runs the IamPolicyStore port-contract kit (../store-contract.ts) over the
 * OSS adapter (../resource-store.ts) on both drivers through the drivers'
 * own fixtures (sqlite always; Postgres under TEST_DATABASE_URL), and pins
 * the two behaviours that are the OSS adapter's rather than the port's:
 * save refuses a policy whose id is not the triple's derived id, the
 * invariant that makes "one row per triple" the primary key's job in open
 * source; and a principal's rows are read through the kind's list index,
 * never by decoding the whole kind, because the built-in authorizer reads
 * them on every check.
 *
 * The kit's case list is pinned by name so a case cannot drop out unnoticed:
 * the cloud driver's test iterates the same export over `cloud.iam_policy`
 * and would silently prove less (the 2a A11 discipline). The corners A12
 * taught are cases from the start: every relation on a pair; distinct
 * principals, not rows; the scope-tuple exclusions verbatim; unknown-id
 * delete a no-op; a held triple refused.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import type { Store } from "../../../store/interface.js";
import { PostgresStore } from "../../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../../store/postgres/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../constants.js";
import { newResourceIamPolicyStore } from "../resource-store.js";
import type { IamPolicyStoreContractFixture } from "../store-contract.js";
import { iamPolicyStoreContract } from "../store-contract.js";
import { orgRole } from "./support.js";

/** The kit's contract lines, pinned: a dropped or renamed case is a visible diff here. */
const CONTRACT_CASE_NAMES = [
  "save then findById round-trips the policy",
  "a second save under a held triple is DuplicatePolicyError, and the first row stands",
  "findByPrincipalAndResource answers every relation on the pair and nothing on another",
  "findByPrincipal and findByResource answer each side of a row",
  "findByResourceWithRelations filters to the allowlist; an empty allowlist matches nothing",
  "countDistinctPrincipalsByResource counts (kind, id) pairs, not rows, optionally by principal kind",
  "findScopeTuple skips identity_account and team principals and owner and creator relations",
  "deleteById removes the row; the triple is free to be granted again",
  "deleteById of an unknown id resolves",
  "a disconnected store is an infrastructure fault, never 'not found'",
  "two concurrent saves of one triple end in one row and DuplicatePolicyErrors only",
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
    const store = await PostgresStore.open(
      postgresDatabase.databaseUrl,
      undefined,
      { listIndexes: LIST_INDEXES },
    );
    await store.deleteResourcesByKind(ApiResourceKind.iam_policy);
    return { store, close: () => store.close() };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.each([sqliteFixture, postgresFixture])(
  "IamPolicyStore over the OSS adapter ($name)",
  (fixture) => {
    describe.skipIf(fixture.skip)("the port-contract kit", () => {
      const cases = iamPolicyStoreContract(
        async (): Promise<IamPolicyStoreContractFixture> => {
          const opened = await fixture.open();
          return {
            store: newResourceIamPolicyStore(opened.store),
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

    describe.skipIf(fixture.skip)("the OSS adapter's own invariant", () => {
      let opened: OpenedStore;

      beforeEach(async () => {
        opened = await fixture.open();
      });

      afterEach(async () => {
        await opened.close();
      });

      it("refuses to save a policy whose id is not its triple's derived id", async () => {
        const policies = newResourceIamPolicyStore(opened.store);
        const spec = orgRole("ida_wtr3jcf281yfk9xx61kj59fsme", "admin", "acme");
        const stray = create(IamPolicySchema, {
          apiVersion: IAM_POLICY_API_VERSION,
          kind: IAM_POLICY_KIND,
          metadata: create(ApiResourceMetadataSchema, {
            id: "iamp_01hzzzzzzzzzzzzzzzzzzzzzzz",
          }),
          spec,
        });
        await expect(policies.save(stray)).rejects.toThrow(
          "policy id must be derived from its triple",
        );
        expect(
          await opened.store.listResources(ApiResourceKind.iam_policy),
        ).toHaveLength(0);

        const derived = create(IamPolicySchema, {
          apiVersion: IAM_POLICY_API_VERSION,
          kind: IAM_POLICY_KIND,
          metadata: create(ApiResourceMetadataSchema, {
            id: policyIdFor(spec),
          }),
          spec,
        });
        await policies.save(derived);
        expect((await policies.findById(policyIdFor(spec)))?.spec).toEqual(
          spec,
        );
      });

      it("reads a principal's rows through the list index, never by decoding the whole kind", async () => {
        let scans = 0;
        const target = opened.store;
        // Every method runs on the real store; only the scan is counted.
        const counted = new Proxy(target, {
          get(store, property) {
            if (property === "listResources") {
              return (kind: ApiResourceKind) => {
                if (kind === ApiResourceKind.iam_policy) {
                  scans += 1;
                }
                return store.listResources(kind);
              };
            }
            const value: unknown = Reflect.get(store, property, store);
            return typeof value === "function" ? value.bind(store) : value;
          },
        });
        const policies = newResourceIamPolicyStore(counted);
        for (const [principal, relation] of [
          ["ida_wtr3jcf281yfk9xx61kj59fsme", "admin"],
          ["ida_wtr3jcf281yfk9xx61kj59fsme", "member"],
          ["ida_0hlf2yb5mhkgb3bdzkkrptqf4d", "member"],
        ] as const) {
          const spec = orgRole(principal, relation, "acme");
          await policies.save(
            create(IamPolicySchema, {
              apiVersion: IAM_POLICY_API_VERSION,
              kind: IAM_POLICY_KIND,
              metadata: create(ApiResourceMetadataSchema, {
                id: policyIdFor(spec),
              }),
              spec,
            }),
          );
        }
        const found = await policies.findByPrincipal(
          "identity_account",
          "ida_wtr3jcf281yfk9xx61kj59fsme",
        );
        expect(found.map((policy) => policy.spec?.relation).sort()).toEqual([
          "admin",
          "member",
        ]);
        expect(
          await policies.findByPrincipal(
            "team",
            "ida_wtr3jcf281yfk9xx61kj59fsme",
          ),
        ).toEqual([]);
        expect(scans).toBe(0);
      });
    });
  },
);
