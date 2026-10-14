/**
 * Runs the IamPolicyStore port-contract kit (../store-contract.ts) over the
 * OSS adapter (../resource-store.ts) on both drivers through the drivers'
 * own fixtures (sqlite always; Postgres under TEST_DATABASE_URL), opened
 * with and without the permission history, and pins the behaviours that
 * are the adapter's rather than the port's: save refuses a policy whose id
 * is not the triple's derived id, the invariant that makes "one row per
 * triple" the primary key's job in open source; a principal's rows are
 * read through the kind's list index, never by decoding the whole kind,
 * because the built-in authorizer reads them on every check; two
 * concurrent saves of one triple end in one row and one winner; and the
 * history: kept, one entry per change the grant path records and none for
 * a duplicate or an id not held, read back through the port by the kit's
 * history cases; not kept, none at all.
 *
 * The kit's case list is pinned by name so a case cannot drop out unnoticed:
 * another driver's test iterates the same export over its own table and
 * would silently prove less. Known corners are cases from the start: every
 * relation on a pair; distinct
 * principals, not rows; the scope-tuple exclusions verbatim; unknown-id
 * delete a no-op; a held triple refused.
 */
import { DatabaseSync } from "node:sqlite";

import { create } from "@bufbuild/protobuf";
import pg from "pg";
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
import type { PolicyChangeRecord } from "../change.js";
import { newResourceIamPolicyStore } from "../resource-store.js";
import { DuplicatePolicyError } from "../store.js";
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
  "findByResourceKindAndRelation answers every row granting the relation on the kind, and nothing on another kind or relation",
  "deleteById removes the row; the triple is free to be granted again",
  "a change record changes nothing about the row: save and deleteById behave as without one",
  "deleteById of an unknown id resolves",
  "a disconnected store is an infrastructure fault, never 'not found'",
  "two concurrent saves of one triple end in one row and DuplicatePolicyErrors only",
] as const;

/** The history lines, pinned the same way, by whether the store keeps one. */
const HISTORY_CASE_NAMES = {
  kept: [
    "with a history, each recorded write that changed a row reads back as one change, in order, and nothing else does",
    "with a history, newest first below a number and oldest first above one page exactly at their edges",
    "with a history, a removal takes only the changes recorded before the instant, a prefix of each organization, and the numbering continues",
    "with a history, a limit removes the oldest first and leaves the rest for the next call",
  ],
  notKept: ["without a history, a recorded write leaves no change to read and a removal removes nothing"],
} as const;

/** One permission-history entry, the columns the adapter's cases read. */
interface HistoryEntry {
  readonly org: string;
  readonly sequence: number;
  readonly change: string;
  readonly cause: string;
  readonly actorId: string;
  readonly actorClass: string;
  readonly policyId: string;
}

const HISTORY_SQL = `SELECT org, sequence, change, cause, actor_id, actor_class, policy_id
  FROM iam_policy_history ORDER BY org, sequence`;

function historyEntryOf(row: Record<string, unknown>): HistoryEntry {
  return {
    org: String(row.org),
    sequence: Number(row.sequence),
    change: String(row.change),
    cause: String(row.cause),
    actorId: String(row.actor_id),
    actorClass: String(row.actor_class),
    policyId: String(row.policy_id),
  };
}

interface OpenedStore {
  readonly store: Store;
  /** Every permission-history entry, read raw, beside the port's own read. */
  history(): Promise<HistoryEntry[]>;
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
    return {
      store: temp.store,
      async history() {
        const db = new DatabaseSync(temp.dbPath);
        try {
          return (db.prepare(HISTORY_SQL).all() as Array<Record<string, unknown>>).map(
            historyEntryOf,
          );
        } finally {
          db.close();
        }
      },
      close: () => temp.cleanup(),
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
    const store = await PostgresStore.open(
      postgresDatabase.databaseUrl,
      undefined,
      { listIndexes: LIST_INDEXES },
    );
    await store.deleteResourcesByKind(ApiResourceKind.iam_policy);
    const raw = new pg.Pool({ connectionString: postgresDatabase.databaseUrl, max: 1 });
    await raw.query(`TRUNCATE iam_policy_history, iam_policy_history_heads`);
    return {
      store,
      async history() {
        const result = await raw.query(HISTORY_SQL);
        return (result.rows as Array<Record<string, unknown>>).map(historyEntryOf);
      },
      async close() {
        await raw.end();
        await store.close();
      },
    };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.each([sqliteFixture, postgresFixture])(
  "IamPolicyStore over the OSS adapter ($name)",
  (fixture) => {
    describe.skipIf(fixture.skip).each([
      { keepsHistory: false },
      { keepsHistory: true },
    ])("the port-contract kit (keepsHistory: $keepsHistory)", (options) => {
      const cases = iamPolicyStoreContract(
        async (): Promise<IamPolicyStoreContractFixture> => {
          const opened = await fixture.open();
          return {
            store: newResourceIamPolicyStore(opened.store, options),
            disconnect: () => opened.store.close(),
            cleanup: () => opened.close(),
          };
        },
        options,
      );

      it("carries every contract line, by name", () => {
        expect(cases.map((contractCase) => contractCase.name)).toEqual([
          ...CONTRACT_CASE_NAMES,
          ...(options.keepsHistory ? HISTORY_CASE_NAMES.kept : HISTORY_CASE_NAMES.notKept),
        ]);
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
        const policies = newResourceIamPolicyStore(opened.store, {
          keepsHistory: false,
        });
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
        const policies = newResourceIamPolicyStore(counted, {
          keepsHistory: false,
        });
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

      it("ends two concurrent saves of one triple in one row, one winner and DuplicatePolicyErrors only", async () => {
        const policies = newResourceIamPolicyStore(opened.store, {
          keepsHistory: true,
        });
        const spec = orgRole("ida_wtr3jcf281yfk9xx61kj59fsme", "member", "acme");
        const outcomes = await Promise.allSettled(
          Array.from({ length: 6 }, () =>
            policies.save(policyOf(spec), record("grant", "acme")),
          ),
        );
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") {
            expect(outcome.reason).toBeInstanceOf(DuplicatePolicyError);
          }
        }
        expect(await opened.store.listResources(ApiResourceKind.iam_policy)).toHaveLength(1);
        expect(await opened.history()).toHaveLength(1);
      });
    });

    describe.skipIf(fixture.skip)("the permission history", () => {
      let opened: OpenedStore;

      beforeEach(async () => {
        opened = await fixture.open();
      });

      afterEach(async () => {
        await opened.close();
      });

      it("kept: one entry per change the grant path records, none for a duplicate, an id not held or a structural row", async () => {
        const policies = newResourceIamPolicyStore(opened.store, {
          keepsHistory: true,
        });
        const ana = orgRole("ida_wtr3jcf281yfk9xx61kj59fsme", "member", "acme");
        const raj = orgRole("ida_0hlf2yb5mhkgb3bdzkkrptqf4d", "admin", "acme");
        await policies.save(policyOf(ana), record("grant", "acme"));
        await expect(
          policies.save(policyOf(ana), record("grant", "acme")),
        ).rejects.toBeInstanceOf(DuplicatePolicyError);
        await policies.save(policyOf(raj), {
          actor: { id: "ida_server", callerClass: "internal" },
          cause: "first_sign_in",
          organizationId: "acme",
        });
        await policies.deleteById(policyIdFor(ana), record("left_organization", "acme"));
        await policies.deleteById(policyIdFor(ana), record("left_organization", "acme"));
        await policies.deleteById("iamp_01hzzzzzzzzzzzzzzzzzzzzzzz", record("revoke", "acme"));
        const structural = orgRole("ida_structural0000000000000000", "member", "beta");
        await policies.save(policyOf(structural));
        await policies.deleteById(policyIdFor(structural));

        expect(await opened.history()).toEqual([
          {
            org: "acme",
            sequence: 1,
            change: "granted",
            cause: "grant",
            actorId: "ida_ana",
            actorClass: "user",
            policyId: policyIdFor(ana),
          },
          {
            org: "acme",
            sequence: 2,
            change: "granted",
            cause: "first_sign_in",
            actorId: "ida_server",
            actorClass: "internal",
            policyId: policyIdFor(raj),
          },
          {
            org: "acme",
            sequence: 3,
            change: "revoked",
            cause: "left_organization",
            actorId: "ida_ana",
            actorClass: "user",
            policyId: policyIdFor(ana),
          },
        ]);
      });

      it("not kept: the records change nothing and nothing is written", async () => {
        const policies = newResourceIamPolicyStore(opened.store, {
          keepsHistory: false,
        });
        const ana = orgRole("ida_wtr3jcf281yfk9xx61kj59fsme", "member", "acme");
        await policies.save(policyOf(ana), record("grant", "acme"));
        expect((await policies.findById(policyIdFor(ana)))?.spec).toEqual(ana);
        await policies.deleteById(policyIdFor(ana), record("revoke", "acme"));
        expect(await policies.findById(policyIdFor(ana))).toBeUndefined();
        expect(await opened.history()).toEqual([]);
      });
    });
  },
);

/** The row the grant path writes for a triple: its derived id and the triple. */
function policyOf(spec: ReturnType<typeof orgRole>) {
  return create(IamPolicySchema, {
    apiVersion: IAM_POLICY_API_VERSION,
    kind: IAM_POLICY_KIND,
    metadata: create(ApiResourceMetadataSchema, { id: policyIdFor(spec) }),
    spec,
  });
}

/** A change record by Ana, a user, through `cause`. */
function record(
  cause: PolicyChangeRecord["cause"],
  organizationId: string,
): PolicyChangeRecord {
  return {
    actor: { id: "ida_ana", callerClass: "user" },
    cause,
    organizationId,
  };
}
