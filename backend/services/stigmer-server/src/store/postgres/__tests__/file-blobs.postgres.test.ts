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

const TABLES = ["resources", "resource_list_keys", "file_blobs", "file_blob_refs"] as const;

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
    return { store, cleanup: () => store.close() };
  });
});
