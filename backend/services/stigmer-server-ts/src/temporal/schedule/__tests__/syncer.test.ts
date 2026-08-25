/**
 * Pins the syncer against Go's syncer.go: the create-or-update convergence
 * on ScheduleAlreadyRunning, next_fire_at stamped from Temporal's OWN
 * answer through the atomic row write (undefined while paused), teardown's
 * not-found-is-success idempotence, and the unavailable posture when no
 * client exists (panel finding 1 — this machinery previously shipped
 * untested).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";
import { ScheduleAlreadyRunning, ScheduleNotFoundError } from "@temporalio/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { ScheduleArtifact } from "../artifact.js";
import { ScheduleTemporalConfig } from "../config.js";
import { ScheduleSyncer, TemporalUnavailableError } from "../syncer.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const config = new ScheduleTemporalConfig("schedule_stigmer", 60, 24, 5, 60, true, 5, 20, 1.0, 90);

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
}

let fake: FakeScheduleApi;

function fakeClient(): Client {
  const schedule = {
    create: async () => {
      fake.createCalls++;
      if (fake.createError) throw fake.createError;
    },
    getHandle: (scheduleId: string) => ({
      describe: async () => ({ info: { nextActionTimes: fake.describeNextActionTimes } }),
      update: async () => {
        fake.updateCalls++;
        if (fake.updateError) throw fake.updateError;
      },
      delete: async () => {
        fake.deleteCalls.push(scheduleId);
        if (fake.deleteError) throw fake.deleteError;
      },
    }),
  };
  return { schedule } as unknown as Client;
}

function scheduleRow(overrides?: { enabled?: boolean; pausedReason?: string }) {
  return create(ScheduleSchema, {
    metadata: { id: "sch_01sync", org: "acme", slug: "daily" },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      enabled: overrides?.enabled ?? true,
      target: { case: "agent", value: { agentRef: { slug: "helper" } } },
    },
    status: { pausedReason: overrides?.pausedReason ?? "" },
  });
}

function syncer(client: Client | undefined): ScheduleSyncer {
  return new ScheduleSyncer(
    () => client,
    store,
    new ScheduleArtifact(config),
    silentLogger,
  );
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
  await store.saveResource(ApiResourceKind.schedule, "sch_01sync", ScheduleSchema, scheduleRow());
});

describe("ensureAndRecord — create-or-update convergence", () => {
  it("creates a missing artifact and stamps next_fire_at from Temporal's answer", async () => {
    const next = await syncer(fakeClient()).ensureAndRecord(scheduleRow());
    expect(fake.createCalls).toBe(1);
    expect(fake.updateCalls).toBe(0);
    expect(next).toEqual(new Date("2026-08-26T09:00:00Z"));

    const row = await store.getResource(ApiResourceKind.schedule, "sch_01sync", ScheduleSchema);
    expect(row.status?.nextFireAt?.seconds).toBe(
      BigInt(Date.parse("2026-08-26T09:00:00Z") / 1000),
    );
    expect(row.status?.audit?.statusAudit?.event).toBe("updated");
  });

  it("falls to the update path on ScheduleAlreadyRunning (benign lost race)", async () => {
    fake.createError = new ScheduleAlreadyRunning("exists", "schedule/tick/sch_01sync");
    const next = await syncer(fakeClient()).ensureAndRecord(scheduleRow());
    expect(fake.updateCalls).toBe(1);
    expect(next).toEqual(new Date("2026-08-26T09:00:00Z"));
  });

  it("wraps a non-AlreadyRunning create failure with the artifact id", async () => {
    fake.createError = new Error("frontend hiccup");
    await expect(syncer(fakeClient()).ensureAndRecord(scheduleRow())).rejects.toThrow(
      "create schedule artifact schedule/tick/sch_01sync: frontend hiccup",
    );
  });

  it("a paused schedule stamps next_fire_at ABSENT (never describes)", async () => {
    const paused = scheduleRow({ enabled: false });
    await store.saveResource(ApiResourceKind.schedule, "sch_01sync", ScheduleSchema, paused);
    const next = await syncer(fakeClient()).ensureAndRecord(paused);
    expect(next).toBeUndefined();
    const row = await store.getResource(ApiResourceKind.schedule, "sch_01sync", ScheduleSchema);
    expect(row.status?.nextFireAt).toBeUndefined();
  });

  it("a row deleted between arm and stamp is a logged no-op, not an error", async () => {
    await store.deleteResource(ApiResourceKind.schedule, "sch_01sync");
    const next = await syncer(fakeClient()).ensureAndRecord(scheduleRow());
    expect(next).toEqual(new Date("2026-08-26T09:00:00Z"));
  });

  it("throws TemporalUnavailableError when no client exists (arming degrades upstream)", async () => {
    await expect(syncer(undefined).ensureAndRecord(scheduleRow())).rejects.toBeInstanceOf(
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
    const result = await syncer(undefined).peekNextFireAt(scheduleRow({ pausedReason: "Paused" }));
    expect(result).toBeUndefined();
  });

  it("answers undefined when Temporal reports no upcoming action", async () => {
    fake.describeNextActionTimes = [];
    const result = await syncer(fakeClient()).peekNextFireAt(scheduleRow());
    expect(result).toBeUndefined();
  });
});
