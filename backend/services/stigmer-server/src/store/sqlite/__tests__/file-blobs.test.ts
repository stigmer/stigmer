/**
 * Runs the File blob store contract (../../__tests__/file-blobs-contract.ts)
 * on the SQLite driver, one throwaway database file per case; a seeded
 * conversion rides a second connection.
 */
import { DatabaseSync } from "node:sqlite";

import { describe } from "vitest";

import {
  FILE_BLOBS_CONTRACT_STORE_OPTIONS,
  describeFileBlobStoreContract,
} from "../../__tests__/file-blobs-contract.js";
import { tempStore } from "./support.js";

describe("sqlite file blob store contract", () => {
  describeFileBlobStoreContract(async () => {
    const temp = tempStore(FILE_BLOBS_CONTRACT_STORE_OPTIONS);
    return {
      store: temp.store,
      async seedConversion(c) {
        const db = new DatabaseSync(temp.dbPath);
        try {
          db.prepare(
            `INSERT INTO file_conversions
               (run_id, position, org, session_id, filename, storage_key, content_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(c.runId, c.position, c.org, c.sessionId, c.filename, c.storageKey, c.contentType, c.createdAt);
        } finally {
          db.close();
        }
      },
      async seedOutputConversion(c) {
        const db = new DatabaseSync(temp.dbPath);
        try {
          db.prepare(
            `INSERT INTO output_conversions
               (run_id, position, org, session_id, name, storage_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(c.runId, c.position, c.org, c.sessionId, c.name, c.storageKey, c.createdAt);
        } finally {
          db.close();
        }
      },
      cleanup: () => temp.cleanup(),
    };
  });
});
