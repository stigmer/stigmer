/**
 * Runs the File blob store contract (../../__tests__/file-blobs-contract.ts)
 * on the Postgres driver, where its two races prove the blob row's lock:
 * each case opens a fresh store over one database whose tables the case
 * before it left empty.
 *
 * Gated on TEST_DATABASE_URL (see support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterAll, beforeAll, describe } from "vitest";

import pg from "pg";

import {
  FILE_BLOBS_CONTRACT_STORE_OPTIONS,
  describeFileBlobStoreContract,
} from "../../__tests__/file-blobs-contract.js";
import { PostgresStore } from "../store.js";
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from "./support.js";

const TABLES = ["resources", "resource_list_keys", "file_blobs", "file_blob_refs", "file_conversions", "output_conversions"] as const;

describe.skipIf(testDatabaseAdminUrl() === undefined)("postgres file blob store contract", () => {
  let db: TestDatabase;
  let hooks: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    hooks = new pg.Pool({ connectionString: db.databaseUrl, max: 1 });
    const first = await PostgresStore.open(db.databaseUrl);
    await first.close();
  });

  afterAll(async () => {
    await hooks.end();
    await db.drop();
  });

  describeFileBlobStoreContract(async () => {
    await hooks.query(`TRUNCATE ${TABLES.join(", ")}`);
    const store = await PostgresStore.open(db.databaseUrl, undefined, FILE_BLOBS_CONTRACT_STORE_OPTIONS);
    return {
      store,
      async seedConversion(c) {
        await hooks.query(
          `INSERT INTO file_conversions
             (run_id, position, org, session_id, filename, storage_key, content_type, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [c.runId, c.position, c.org, c.sessionId, c.filename, c.storageKey, c.contentType, c.createdAt],
        );
      },
      async seedOutputConversion(c) {
        await hooks.query(
          `INSERT INTO output_conversions
             (run_id, position, org, session_id, name, storage_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [c.runId, c.position, c.org, c.sessionId, c.name, c.storageKey, c.createdAt],
        );
      },
      cleanup: () => store.close(),
    };
  });
});
