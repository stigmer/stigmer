/**
 * Runs the session event store kit (../session-events-contract.ts) on both
 * drivers, each opened with the options the kit hands it (the server's
 * list indexes, as the composition root opens a store): SQLite always,
 * Postgres under TEST_DATABASE_URL. The
 * kit's case list is pinned by name here, so a case cannot drop out of the
 * kit unnoticed: the cloud's test iterates the same export and would
 * silently prove less.
 */
import { afterAll, describe, expect, it } from "vitest";

import type { Store, StoreOpenOptions } from "../interface.js";
import { PostgresStore } from "../postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../postgres/__tests__/support.js";
import { sessionEventStoreContract } from "../session-events-contract.js";
import { tempStore } from "../sqlite/__tests__/support.js";

/** The kit's contract lines, pinned: a dropped or renamed case is a visible diff here. */
const CONTRACT_CASE_NAMES = [
  "append numbers a session's events from 1 in order and stamps each append with one fixed-width accepted time",
  "concurrent appends to one session leave no gap and no repeated number",
  "a resent event with the same bytes answers its stored record and is not appended again",
  "a resent id with other bytes is refused and appends nothing of its batch",
  "an event id is unique per session, not across sessions",
  "append appends nothing when its guard refuses or its row is absent",
  "list reads by seq in either order, after a seq, by type, and within accepted-time bounds",
  "a resource write commits the row with its events and hands the writer the committed row",
  "a resource write that throws commits neither the row nor its events",
  "the working count is the session's other working rows: not the row itself, not another session's, not a stopped one",
  "writers of one session run one after the other, each counting what the other committed",
  "removing a row removes its own events except the kept types, and its list keys",
  "a write that names no session finds it through the row, and a row that is not stored is not found",
  "a row in no session writes no events",
  "deleteBySession removes one session's events; deleteByOrg removes an organization's",
  "a disconnected store is an infrastructure fault, never 'not found'",
] as const;

interface DriverFixture {
  readonly name: string;
  readonly skip: boolean;
  open(options: StoreOpenOptions): Promise<{ store: Store; close(): Promise<void> }>;
}

const sqliteFixture: DriverFixture = {
  name: "sqlite",
  skip: false,
  async open(options) {
    const temp = tempStore(options);
    return { store: temp.store, close: () => temp.cleanup() };
  },
};

let postgresDatabase: TestDatabase | undefined;
const postgresFixture: DriverFixture = {
  name: "postgres",
  skip: testDatabaseAdminUrl() === undefined,
  async open(options) {
    postgresDatabase ??= await createTestDatabase();
    const store = await PostgresStore.open(postgresDatabase.databaseUrl, undefined, options);
    return { store, close: () => store.close() };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.each([sqliteFixture, postgresFixture])("the session event log ($name)", (fixture) => {
  describe.skipIf(fixture.skip)("the port-contract kit", () => {
    const cases = sessionEventStoreContract(async (options) => {
      const opened = await fixture.open(options);
      return {
        store: opened.store,
        disconnect: () => opened.store.close(),
        cleanup: () => opened.close(),
      };
    });

    it("carries every contract line, by name", () => {
      expect(cases.map((contractCase) => contractCase.name)).toEqual(CONTRACT_CASE_NAMES);
    });

    for (const contractCase of cases) {
      it(contractCase.name, contractCase.run);
    }
  });
});
