/**
 * Runs the driver-agnostic Store contract suite (../../__tests__/
 * store-contract.ts) against the sqlite driver — the extraction target of
 * the Phase-1 store.test.ts/substores.test.ts interface-shaped cases (T01
 * D-4). sqlite-physical pins stay in store.test.ts; the engine-specific
 * search half stays in fts5.test.ts.
 */
import { DatabaseSync } from "node:sqlite";

import { describe } from "vitest";

import type { StoreContractFixture } from "../../__tests__/store-contract.js";
import { describeStoreContract } from "../../__tests__/store-contract.js";
import { tempStore } from "./support.js";

describe("sqlite store contract", () => {
  describeStoreContract(async (): Promise<StoreContractFixture> => {
    const temp = tempStore();
    return {
      store: temp.store,
      async forceDedupeExpiry(id, expiresAtIso) {
        // A second connection: the store's own is busy being the subject.
        const db = new DatabaseSync(temp.dbPath);
        db.prepare(`UPDATE signal_dedupe SET expires_at = ? WHERE id = ?`).run(
          expiresAtIso,
          id,
        );
        db.close();
      },
      async countPendingOAuthStates() {
        const db = new DatabaseSync(temp.dbPath);
        const row = db
          .prepare(`SELECT COUNT(*) AS count FROM pending_oauth_state`)
          .get() as { count: number };
        db.close();
        return row.count;
      },
      cleanup: () => temp.cleanup(),
    };
  });
});
