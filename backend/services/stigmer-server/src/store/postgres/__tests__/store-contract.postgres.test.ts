/**
 * Runs the driver-agnostic Store contract suite (../../__tests__/
 * store-contract.ts) against the Postgres driver — the proof that the
 * two drivers are contract-twins — plus the driver-relative ranking pin
 * the shared suite deliberately leaves out (search-result order within one
 * driver is contract; order across drivers is not).
 *
 * Also two faults of this driver's name-store transactions: a race only
 * this engine admits (a release that commits between a losing name claim's
 * insert and its read of the holder, which read committed lets the claim
 * see; the claim fails and claims nothing, never answering a holder that is
 * gone), and a rollback that fails after a failed write (the write's error
 * is the one reported).
 *
 * Gated on TEST_DATABASE_URL (see support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import pg from "pg";

import type { Store } from "../../interface.js";
import { apiResourceKindName } from "../../proto-fields.js";
import type { StoreContractFixture } from "../../__tests__/store-contract.js";
import {
  CONTRACT_STORE_OPTIONS,
  describeStoreContract,
} from "../../__tests__/store-contract.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

const ALL_TABLES = [
  "resources",
  "resource_list_keys",
  "resource_audit",
  "search_index",
  "bootstrap_state",
  "schedule_runs",
  "resource_names",
  "pending_oauth_state",
  "oauth_client_registration",
  "connect_link",
  "connect_attempt",
] as const;

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres store contract",
  () => {
    let db: TestDatabase;
    // A hook pool separate from the store under test: the escape hatches
    // and the per-test truncate must work even mid-lifecycle-test.
    let hooks: pg.Pool;

    beforeAll(async () => {
      db = await createTestDatabase();
      hooks = new pg.Pool({ connectionString: db.databaseUrl, max: 2 });
      // First open applies the migration chain once for the whole file.
      const first = await PostgresStore.open(db.databaseUrl);
      await first.close();
    });

    afterAll(async () => {
      await hooks.end();
      await db.drop();
    });

    describeStoreContract(async (): Promise<StoreContractFixture> => {
      // Fresh-state isolation without a per-test CREATE DATABASE:
      // truncate everything, fresh store instance per test (the lifecycle
      // test closes its store).
      await hooks.query(
        `TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
      );
      const store = await PostgresStore.open(
        db.databaseUrl,
        undefined,
        CONTRACT_STORE_OPTIONS,
      );
      const others: Store[] = [];
      return {
        store,
        async countPendingOAuthStates() {
          const result = await hooks.query(
            `SELECT COUNT(*) AS count FROM pending_oauth_state`,
          );
          return Number((result.rows[0] as { count: string }).count);
        },
        async writeAsOlderBinary(kind, id, data) {
          // The statement this driver ran before the list index existed.
          await hooks.query(
            `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = now()`,
            [apiResourceKindName(kind), id, Buffer.from(data)],
          );
        },
        async countUnproven(kind, revision) {
          const revisionArm =
            revision === undefined
              ? ""
              : ` OR list_index_revision IS NULL OR list_index_revision <> $2`;
          const result = await hooks.query(
            `SELECT COUNT(*) AS count FROM resources
             WHERE kind = $1 AND (list_indexed_at IS DISTINCT FROM updated_at${revisionArm})`,
            revision === undefined
              ? [apiResourceKindName(kind)]
              : [apiResourceKindName(kind), revision],
          );
          return Number((result.rows[0] as { count: string }).count);
        },
        async openAnother(options) {
          const other = await PostgresStore.open(
            db.databaseUrl,
            undefined,
            options,
          );
          others.push(other);
          return other;
        },
        async cleanup() {
          for (const other of others) {
            await other.close();
          }
          await store.close();
        },
      };
    });

    describe("driver-relative search ranking", () => {
      it("a name hit outranks a description hit (name carries setweight A)", async () => {
        await hooks.query(
          `TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
        );
        const store = await PostgresStore.open(db.databaseUrl);
        try {
          await store.upsertSearchIndex(ApiResourceKind.agent, "agt-name", {
            name: "billing reconciler",
            description: "does things nightly",
            tags: "",
            org: "acme",
            visibility: "visibility_org",
            createdAt: 1,
          });
          await store.upsertSearchIndex(ApiResourceKind.agent, "agt-desc", {
            name: "invoice sync",
            description: "synchronizes the billing ledger",
            tags: "",
            org: "acme",
            visibility: "visibility_org",
            createdAt: 2,
          });

          const result = await store.querySearchIndex({
            kinds: ["agent"],
            terms: ["billing"],
            orgFilter: "",
            limit: 20,
            offset: 0,
          });

          expect(result.totalCount).toBe(2);
          expect(result.hits[0]?.resourceId).toBe("agt-name");
          expect(result.hits[0]!.score).toBeGreaterThan(result.hits[1]!.score);
        } finally {
          await store.close();
        }
      });
    });

    describe("the name store's transactions under faults", () => {
      type Query = (...args: unknown[]) => Promise<unknown>;

      /**
       * Wraps the query method of every client the store checks out with a
       * bare connect() (its transactions); the hook pool's queries pass a
       * callback and are left alone. Restore the spy to stop wrapping.
       */
      function wrapTransactionQueries(wrap: (query: Query) => Query) {
        const connect = pg.Pool.prototype.connect;
        return vi
          .spyOn(pg.Pool.prototype, "connect")
          .mockImplementation(function (
            this: pg.Pool,
            ...args: unknown[]
          ): Promise<pg.PoolClient> {
            const checkout = (connect as (...a: unknown[]) => unknown).apply(
              this,
              args,
            ) as Promise<pg.PoolClient>;
            if (args.length > 0) {
              return checkout;
            }
            return checkout.then((client) => {
              const query = client.query.bind(client) as Query;
              (client as { query: unknown }).query = wrap(query);
              return client;
            });
          } as typeof pg.Pool.prototype.connect);
      }

      const key = { kind: "organization", org: "", name: "acme" };
      const now = "2026-01-01T00:00:00.000Z";

      async function freshStore(): Promise<PostgresStore> {
        await hooks.query(
          `TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
        );
        return PostgresStore.open(db.databaseUrl);
      }

      it("a lost claim fails, claiming nothing, when its holder is released before it reads it", async () => {
        const store = await freshStore();
        await store.resourceNames.claim(key, "org_a", now);
        // The release commits on the hook pool's own connection right after
        // the claim's conflicting insert, the window no ordering of two calls
        // can otherwise reach.
        const spy = wrapTransactionQueries((query) => async (...a) => {
          const result = await query(...a);
          if (typeof a[0] === "string" && a[0].includes("DO NOTHING")) {
            await hooks.query(`DELETE FROM resource_names WHERE name = 'acme'`);
          }
          return result;
        });
        try {
          await expect(
            store.resourceNames.claim(key, "org_b", now),
          ).rejects.toThrow(/its holder disappeared during the write/);
          spy.mockRestore();
          expect(await store.resourceNames.resolve(key, now)).toBeUndefined();
          expect(
            (await store.resourceNames.claim(key, "org_b", now)).claimed,
            "a retry takes the name the release freed",
          ).toBe(true);
        } finally {
          spy.mockRestore();
          await store.close();
        }
      });

      it("a failed write reports its own error when the rollback fails too", async () => {
        const store = await freshStore();
        // The insert fails; the rollback runs, then reports a broken
        // connection, as a dropped socket would.
        const spy = wrapTransactionQueries((query) => async (...a) => {
          if (typeof a[0] === "string" && a[0].includes("DO NOTHING")) {
            throw new Error("the write failed");
          }
          if (a[0] === "ROLLBACK") {
            await query(...a);
            throw new Error("connection terminated");
          }
          return query(...a);
        });
        try {
          await expect(
            store.resourceNames.claim(key, "org_a", now),
          ).rejects.toThrow("the write failed");
          spy.mockRestore();
          expect(await store.resourceNames.resolve(key, now)).toBeUndefined();
        } finally {
          spy.mockRestore();
          await store.close();
        }
      });
    });
  },
);
