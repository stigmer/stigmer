/**
 * Runs the driver-agnostic Store contract suite (../../__tests__/
 * store-contract.ts) against the Postgres driver — the D-4 proof that the
 * two drivers are contract-twins — plus the driver-relative ranking pin
 * DD-009 keeps OUT of the shared suite (search-result order within one
 * driver is contract; order across drivers is not).
 *
 * Gated on TEST_DATABASE_URL (see support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  "workflow_execution_events",
  "schedule_runs",
  "signal_dedupe",
  "oauth_grant",
  "pending_oauth_state",
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
        async forceDedupeExpiry(id, expiresAtIso) {
          await hooks.query(
            `UPDATE signal_dedupe SET expires_at = $1 WHERE id = $2`,
            [expiresAtIso, id],
          );
        },
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

    describe("driver-relative search ranking (DD-009)", () => {
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
  },
);
