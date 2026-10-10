/**
 * Runs the session event store kit (../session-events-contract.ts) on both
 * drivers, each opened with the options the kit hands it (the server's
 * list indexes, as the composition root opens a store): SQLite always,
 * Postgres under TEST_DATABASE_URL. The
 * kit's case list is pinned by name here, so a case cannot drop out of the
 * kit unnoticed: the cloud's test iterates the same export and would
 * silently prove less.
 *
 * Beside the kit, what only a driver's own test can set up: a second store
 * on the same database opened without the run index, the binary an older
 * pod runs while a roll overlaps it with the new one. The rows it writes
 * are unproven for the new store, so the working count and a row's
 * session are read from their bytes, and their stale key rows are not
 * believed.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../boot/list-indexes.js";
import { SqliteStore } from "../sqlite/store.js";

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
  "the writer is handed the type of the session's newest state event, read under the lock",
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
  /** The new binary's store and an older one's (no list indexes) on one database. */
  openPair(): Promise<{ store: Store; old: Store; close(): Promise<void> }>;
}

const sqliteFixture: DriverFixture = {
  name: "sqlite",
  skip: false,
  async open(options) {
    const temp = tempStore(options);
    return { store: temp.store, close: () => temp.cleanup() };
  },
  async openPair() {
    const temp = tempStore({ listIndexes: LIST_INDEXES });
    const old = SqliteStore.open(temp.dbPath, undefined, {});
    return {
      store: temp.store,
      old,
      close: async () => {
        await old.close();
        await temp.cleanup();
      },
    };
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
  async openPair() {
    postgresDatabase ??= await createTestDatabase();
    const store = await PostgresStore.open(postgresDatabase.databaseUrl, undefined, { listIndexes: LIST_INDEXES });
    const old = await PostgresStore.open(postgresDatabase.databaseUrl, undefined, {});
    return {
      store,
      old,
      close: async () => {
        await old.close();
        await store.close();
      },
    };
  },
};

let counter = 0;
function run(sessionId: string, phase: RunPhase) {
  counter += 1;
  return create(RunSchema, {
    metadata: { id: `run_pair_${Date.now().toString(36)}_${counter}`, org: "org-pair" },
    spec: { target: { case: "sessionId", value: sessionId } },
    status: { phase },
  });
}

const SCOPE = {
  sessionKey: "session",
  workingKey: "working_session",
  stateEventTypes: ["session.status_running", "session.status_idle"],
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

  describe.skipIf(fixture.skip)("rows an older binary wrote, and a store without the run index", () => {
    it("counts an older binary's working run from its bytes, and does not believe its stale key rows", async () => {
      const { store, old, close } = await fixture.openPair();
      try {
        const sessionId = `ses_pair_${Date.now().toString(36)}_${++counter}`;
        // Proven as working by the new binary, then finished by the old one:
        // its key row still says working, its bytes say finished.
        const finished = run(sessionId, RunPhase.RUN_IN_PROGRESS);
        await store.saveResource(ApiResourceKind.run, finished.metadata!.id, RunSchema, finished);
        finished.status!.phase = RunPhase.RUN_COMPLETED;
        await old.saveResource(ApiResourceKind.run, finished.metadata!.id, RunSchema, finished);
        // Working, written only by the old binary: no key row at all.
        const working = run(sessionId, RunPhase.RUN_IN_PROGRESS);
        await old.saveResource(ApiResourceKind.run, working.metadata!.id, RunSchema, working);

        const mine = run(sessionId, RunPhase.RUN_PENDING);
        let others = -1;
        await store.writeResourceAppendingEvents(
          ApiResourceKind.run,
          mine.metadata!.id,
          RunSchema,
          (_previous, session) => {
            others = session.othersWorking;
            return { put: mine, events: [] };
          },
          { ...SCOPE, sessionId },
        );
        expect(others).toBe(1);

        // The old binary's row names its session only in its bytes.
        const result = await store.writeResourceAppendingEvents(
          ApiResourceKind.run,
          working.metadata!.id,
          RunSchema,
          (previous) => ({
            put: previous!,
            events: [{ eventId: "e1", runId: working.metadata!.id, threadId: "", type: "agent.message", data: new Uint8Array() }],
          }),
          SCOPE,
        );
        expect(result.events[0]?.sessionId).toBe(sessionId);
      } finally {
        await close();
      }
    });

    it("a store opened without the kind's list index refuses a write that appends events", async () => {
      const opened = await fixture.open({});
      try {
        const row = run("ses_unindexed", RunPhase.RUN_PENDING);
        await expect(
          opened.store.writeResourceAppendingEvents(
            ApiResourceKind.run,
            row.metadata!.id,
            RunSchema,
            () => ({ put: row, events: [] }),
            { ...SCOPE, sessionId: "ses_unindexed" },
          ),
        ).rejects.toThrow(/is not list-indexed/);
      } finally {
        await opened.close();
      }
    });
  });
});
