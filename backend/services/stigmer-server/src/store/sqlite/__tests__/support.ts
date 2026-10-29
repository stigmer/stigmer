/**
 * Shared helpers for the sqlite driver tests: temp-dir stores. The
 * organization factory lives in ../../__tests__/support.ts, re-exported
 * here so the driver tests import from one place.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { STORE_OPEN_OPTIONS } from "../../../boot/store-options.js";
import type { StoreOpenOptions } from "../../interface.js";
import { SqliteStore } from "../store.js";

export { makeOrganization } from "../../__tests__/support.js";

export interface TempStore {
  store: SqliteStore;
  dbPath: string;
  cleanup(): Promise<void>;
}

/**
 * A fresh store on a throwaway database file, opened with the server's
 * list indexes and session event gates (boot/store-options.ts) the way the
 * composition root opens one, so a lane under test reads through the index it reads in
 * production. `options` replaces them for a test that declares its own.
 */
export function tempStore(
  options: StoreOpenOptions = STORE_OPEN_OPTIONS,
): TempStore {
  const dir = mkdtempSync(path.join(tmpdir(), "stigmer-store-test-"));
  const dbPath = path.join(dir, "stigmer.db");
  const store = SqliteStore.open(dbPath, undefined, options);
  return {
    store,
    dbPath,
    async cleanup() {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
