/**
 * Runs the driver-agnostic Store contract suite (../../__tests__/
 * store-contract.ts) against the sqlite driver — the extraction target of
 * the original store.test.ts/substores.test.ts interface-shaped cases.
 * sqlite-physical pins stay in store.test.ts; the engine-specific
 * search half stays in fts5.test.ts. The escape hatches ride a second
 * connection: the store's own is busy being the subject.
 */
import { DatabaseSync } from "node:sqlite";

import { describe } from "vitest";

import type { Store } from "../../interface.js";
import { apiResourceKindName } from "../../proto-fields.js";
import type { StoreContractFixture } from "../../__tests__/store-contract.js";
import {
  CONTRACT_STORE_OPTIONS,
  describeStoreContract,
  permissionHistoryRowOf,
} from "../../__tests__/store-contract.js";
import { SqliteStore } from "../store.js";
import { tempStore } from "./support.js";

describe("sqlite store contract", () => {
  describeStoreContract(async (): Promise<StoreContractFixture> => {
    const temp = tempStore(CONTRACT_STORE_OPTIONS);
    const others: Store[] = [];
    const withConnection = <T>(work: (db: DatabaseSync) => T): T => {
      const db = new DatabaseSync(temp.dbPath);
      try {
        return work(db);
      } finally {
        db.close();
      }
    };
    return {
      store: temp.store,
      async countPendingOAuthStates() {
        return withConnection(
          (db) =>
            (
              db
                .prepare(`SELECT COUNT(*) AS count FROM pending_oauth_state`)
                .get() as {
                count: number;
              }
            ).count,
        );
      },
      async permissionHistory() {
        return withConnection((db) =>
          (
            db
              .prepare(
                `SELECT org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
                    principal_kind, principal_id, principal_relation, relation, resource_kind,
                    resource_id, data
             FROM grant_history ORDER BY org, sequence`,
              )
              .all() as Array<Record<string, string | number | Uint8Array>>
          ).map(permissionHistoryRowOf),
        );
      },
      async stampPermissionHistory(org, sequence, occurredAt) {
        withConnection((db) =>
          db
            .prepare(`UPDATE grant_history SET occurred_at = ? WHERE org = ? AND sequence = ?`)
            .run(occurredAt, org, sequence),
        );
      },
      async writeAsOlderBinary(kind, id, data) {
        // The statement this driver ran before the list index existed.
        withConnection((db) =>
          db
            .prepare(
              `INSERT OR REPLACE INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`,
            )
            .run(apiResourceKindName(kind), id, data),
        );
      },
      async countUnproven(kind, revision) {
        return withConnection((db) => {
          const revisionArm =
            revision === undefined
              ? ""
              : ` OR list_index_revision IS NULL OR list_index_revision <> ${revision}`;
          return (
            db
              .prepare(
                `SELECT COUNT(*) AS count FROM resources
                 WHERE kind = ? AND (list_indexed_at IS NOT updated_at${revisionArm})`,
              )
              .get(apiResourceKindName(kind)) as { count: number }
          ).count;
        });
      },
      async openAnother(options) {
        const other = SqliteStore.open(temp.dbPath, undefined, options);
        others.push(other);
        return other;
      },
      async cleanup() {
        for (const other of others) {
          await other.close();
        }
        await temp.cleanup();
      },
    };
  });
});
