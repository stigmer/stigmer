/**
 * Pins the syncer against Go's syncer.go: the create-or-update convergence
 * on ScheduleAlreadyRunning (the update rewrites the described artifact to
 * the routine's desired state), next_fire_at stamped from Temporal's OWN
 * answer through the atomic row write (undefined while paused), teardown's
 * not-found-is-success idempotence, the unavailable posture when no
 * client exists (this machinery once shipped untested), and a routine with
 * no cron, which keeps no artifact: converging it removes one a removed
 * cron left, clears next_fire_at (writing nothing when none is set, a
 * no-op when the row is gone, and naming the write when the store
 * faults), and needs no engine at all.
 */
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { Client, ScheduleDescription } from "@temporalio/client";
import { ScheduleAlreadyRunning, ScheduleNotFoundError } from "@temporalio/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { RoutineArtifact } from "../artifact.js";
import { RoutineTemporalConfig } from "../config.js";
import { RoutineSyncer, TemporalUnavailableError } from "../syncer.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const config = new RoutineTemporalConfig("schedule_stigmer", 60, 24, 5, 60, true, 5, 20, 1.0, 90);

let dir: string;
let store: SqliteStore;

/**
 * A scriptable ScheduleClient double. Narrowed through unknown at the ONE
 * seam the syncer touches (client.schedule) — a full Client fake would be
 * machinery without a beneficiary; the script object keeps the calls
 * observable.
 */
interface FakeScheduleApi {
  createError?: Error;
  updateError?: Error;
  deleteError?: Error;
  describeNextActionTimes: Date[];
  createCalls: number;
  updateCalls: number;
  deleteCalls: string[];
  /** What the update callback rewrote the described artifact to. */
  updated?: unknown;
}

/** The live artifact's description the update path rewrites. */
const DESCRIBED = {
  state: { note: "cron=old tz=old", paused: true, remainingActions: 0 },
} as unknown as ScheduleDescription;

let fake: FakeScheduleApi;

function fakeClient(): Client {
  const schedule = {
    create: async () => {
      fake.createCalls++;
      if (fake.createError) throw fake.createError;
    },
    getHandle: (scheduleId: string) => ({
      describe: async () => ({ info: { nextActionTimes: fake.describeNextActionTimes } }),
      update: async (rewrite: (previous: ScheduleDescription) => unknown) => {
        fake.updateCalls++;
        if (fake.updateError) throw fake.updateError;
        fake.updated = rewrite(DESCRIBED);
      },
      delete: async () => {
        fake.deleteCalls.push(scheduleId);
        if (fake.deleteError) throw fake.deleteError;
      },
    }),
  };
  return { schedule } as unknown as Client;
}

function routineRow(overrides?: { enabled?: boolean; pausedReason?: string }) {
  return create(RoutineSchema, {
    metadata: { id: "sch_01sync", org: "acme", slug: "daily" },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      enabled: overrides?.enabled ?? true,
      agent: { agentRef: { slug: "helper" } },
    },
    status: { pausedReason: overrides?.pausedReason ?? "" },
  });
}

function syncer(client: Client | undefined, store_: Store = store): RoutineSyncer {
  return new RoutineSyncer(
    () => client,
    store_,
    new RoutineArtifact(config),
    silentLogger,
  );
}

/** The test store with its row write rejecting as a database fault would. */
function faultingWrites(): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "updateResource") {
        return () => Promise.reject(new Error("database offline"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "schedule-syncer-test-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  fake = {
    describeNextActionTimes: [new Date("2026-08-26T09:00:00Z")],
    createCalls: 0,
    updateCalls: 0,
    deleteCalls: [],
  };
  await store.saveResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema, routineRow());
});

describe("ensureAndRecord — create-or-update convergence", () => {
  it("creates a missing artifact and stamps next_fire_at from Temporal's answer", async () => {
    const next = await syncer(fakeClient()).ensureAndRecord(routineRow());
    expect(fake.createCalls).toBe(1);
    expect(fake.updateCalls).toBe(0);
    expect(next).toEqual(new Date("2026-08-26T09:00:00Z"));

    const row = await store.getResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema);
    expect(row.status?.nextFireAt?.seconds).toBe(
      BigInt(Date.parse("2026-08-26T09:00:00Z") / 1000),
    );
    expect(row.status?.audit?.statusAudit?.event).toBe("updated");
  });

  it("falls to the update path on ScheduleAlreadyRunning (benign lost race), rewriting the artifact to the desired state", async () => {
    fake.createError = new ScheduleAlreadyRunning("exists", "schedule/tick/sch_01sync");
    const next = await syncer(fakeClient()).ensureAndRecord(routineRow());
    expect(fake.updateCalls).toBe(1);
    expect(next).toEqual(new Date("2026-08-26T09:00:00Z"));
    expect(fake.updated).toMatchObject({
      spec: { cronExpressions: ["0 9 * * *"], timezone: "UTC" },
      state: { note: "cron=0 9 * * * tz=UTC", paused: false, remainingActions: 0 },
    });
  });

  it("wraps a non-AlreadyRunning create failure with the artifact id", async () => {
    fake.createError = new Error("frontend hiccup");
    await expect(syncer(fakeClient()).ensureAndRecord(routineRow())).rejects.toThrow(
      "create schedule artifact schedule/tick/sch_01sync: frontend hiccup",
    );
  });

  it("a paused schedule stamps next_fire_at ABSENT (never describes)", async () => {
    const paused = routineRow({ enabled: false });
    await store.saveResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema, paused);
    const next = await syncer(fakeClient()).ensureAndRecord(paused);
    expect(next).toBeUndefined();
    const row = await store.getResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema);
    expect(row.status?.nextFireAt).toBeUndefined();
  });

  it("a row deleted between arm and stamp is a logged no-op, not an error", async () => {
    await store.deleteResource(ApiResourceKind.routine, "sch_01sync");
    const next = await syncer(fakeClient()).ensureAndRecord(routineRow());
    expect(next).toEqual(new Date("2026-08-26T09:00:00Z"));
  });

  it("throws TemporalUnavailableError when no client exists (arming degrades upstream)", async () => {
    await expect(syncer(undefined).ensureAndRecord(routineRow())).rejects.toBeInstanceOf(
      TemporalUnavailableError,
    );
  });
});

describe("teardown — idempotent from the platform's view", () => {
  it("deletes the artifact", async () => {
    await syncer(fakeClient()).teardown("sch_01sync");
    expect(fake.deleteCalls).toEqual(["schedule/tick/sch_01sync"]);
  });

  it("not-found is success (Temporal's delete is not idempotent; ours is)", async () => {
    fake.deleteError = new ScheduleNotFoundError("gone", "schedule/tick/sch_01sync");
    await expect(syncer(fakeClient()).teardown("sch_01sync")).resolves.toBeUndefined();
  });

  it("other delete failures propagate with the artifact id", async () => {
    fake.deleteError = new Error("boom");
    await expect(syncer(fakeClient()).teardown("sch_01sync")).rejects.toThrow(
      "delete schedule artifact schedule/tick/sch_01sync: boom",
    );
  });
});

describe("peekNextFireAt", () => {
  it("answers undefined while paused without touching Temporal", async () => {
    const result = await syncer(undefined).peekNextFireAt(routineRow({ pausedReason: "Paused" }));
    expect(result).toBeUndefined();
  });

  it("answers undefined when Temporal reports no upcoming action", async () => {
    fake.describeNextActionTimes = [];
    const result = await syncer(fakeClient()).peekNextFireAt(routineRow());
    expect(result).toBeUndefined();
  });
});

describe("ensureAndRecord — a routine with no cron", () => {
  function unscheduled() {
    const routine = routineRow();
    routine.spec!.cron = undefined;
    routine.status!.nextFireAt = timestampFromDate(new Date("2026-08-26T09:00:00Z"));
    return routine;
  }

  it("removes the artifact a removed cron left, creates none, and clears next_fire_at", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema, unscheduled());
    expect(await syncer(fakeClient()).ensureAndRecord(unscheduled())).toBeUndefined();
    expect(fake.createCalls).toBe(0);
    expect(fake.updateCalls).toBe(0);
    expect(fake.deleteCalls).toEqual(["schedule/tick/sch_01sync"]);
    const row = await store.getResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema);
    expect(row.status?.nextFireAt).toBeUndefined();
  });

  it("needs no engine: with no client it neither throws nor asks for one", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema, unscheduled());
    await expect(syncer(undefined).ensureAndRecord(unscheduled())).resolves.toBeUndefined();
    const row = await store.getResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema);
    expect(row.status?.nextFireAt).toBeUndefined();
  });

  it("an artifact already gone is success", async () => {
    fake.deleteError = new ScheduleNotFoundError("gone", "schedule/tick/sch_01sync");
    await expect(syncer(fakeClient()).ensureAndRecord(unscheduled())).resolves.toBeUndefined();
  });

  it("writes nothing when no next_fire_at is set", async () => {
    const neverArmed = unscheduled();
    neverArmed.status!.nextFireAt = undefined;
    await store.saveResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema, neverArmed);
    await expect(syncer(fakeClient(), faultingWrites()).ensureAndRecord(neverArmed)).resolves.toBeUndefined();
    const row = await store.getResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema);
    expect(row.status?.audit?.statusAudit, "no status write was made").toBeUndefined();
  });

  it("a row deleted before next_fire_at clears is a no-op, not an error", async () => {
    await store.deleteResource(ApiResourceKind.routine, "sch_01sync");
    await expect(syncer(fakeClient()).ensureAndRecord(unscheduled())).resolves.toBeUndefined();
    expect(fake.deleteCalls).toEqual(["schedule/tick/sch_01sync"]);
  });

  it("a store fault clearing next_fire_at throws, naming the write", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01sync", RoutineSchema, unscheduled());
    await expect(syncer(fakeClient(), faultingWrites()).ensureAndRecord(unscheduled())).rejects.toThrow(
      "clear next_fire_at: database offline",
    );
  });

  it("peeks no next fire, engine or not", async () => {
    await expect(syncer(undefined).peekNextFireAt(unscheduled())).resolves.toBeUndefined();
  });
});
