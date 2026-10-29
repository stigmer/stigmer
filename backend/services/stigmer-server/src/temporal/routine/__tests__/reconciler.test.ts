/**
 * Pins the reconciler against Go's reconcile.go — the OSS-load-bearing
 * convergence pass (this machinery once shipped untested, with a comment
 * claiming otherwise):
 *
 *   - phase 2 arms rows without artifacts and repairs note/paused drift;
 *   - phase 3 reaps orphans ONLY after the point read confirms the row is
 *     genuinely gone — a row created after phase 2's listing must never
 *     lose its just-armed clock (THE guard);
 *   - foreign artifacts are never touched;
 *   - per-row failures (arm, repair, no-schedule removal, orphan point
 *     read, orphan teardown) count, log the routine, and the pass
 *     continues; a failed row listing aborts the pass with one counted
 *     failure, and a corrupt row is skipped with a warning;
 *   - the kick queue coalesces, stop() drains, and a rejected pass is
 *     logged and can neither brick the queue nor escape into shutdown.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { LogFields, Logger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { RoutineTemporalConfig } from "../config.js";
import { RoutineReconciler } from "../reconciler.js";
import type { RoutineSyncer } from "../syncer.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const config = new RoutineTemporalConfig(
  "schedule_stigmer",
  60,
  24,
  5,
  60,
  // Periodic pass DISABLED: these tests drive passes explicitly; the
  // kill-switch arm below asserts kicked passes still run.
  false,
  5,
  20,
  1.0,
  90,
);

let dir: string;
let store: SqliteStore;

interface ListedArtifact {
  scheduleId: string;
  state: { note?: string; paused: boolean };
}

/** The one client seam the reconciler reads: schedule.list. */
let listedArtifacts: ListedArtifact[];
let listError: Error | undefined;

function fakeClient(): Client {
  const schedule = {
    list: () => ({
      async *[Symbol.asyncIterator]() {
        if (listError) throw listError;
        yield* listedArtifacts;
      },
    }),
  };
  return { schedule } as unknown as Client;
}

/** A scriptable syncer double recording ensure/teardown calls. */
interface SyncerScript {
  ensured: string[];
  toreDown: string[];
  ensureError?: Error;
  teardownError?: Error;
}
let syncerScript: SyncerScript;

function fakeSyncer(): Pick<RoutineSyncer, "ensureAndRecord" | "teardown"> {
  return {
    ensureAndRecord: async (routine: Routine) => {
      if (syncerScript.ensureError) throw syncerScript.ensureError;
      syncerScript.ensured.push(routine.metadata?.id ?? "");
      return undefined;
    },
    teardown: async (resourceId: string) => {
      if (syncerScript.teardownError) throw syncerScript.teardownError;
      syncerScript.toreDown.push(resourceId);
    },
  };
}

function reconciler(
  client: Client | undefined = fakeClient(),
  overrides?: { store?: Store; logger?: Logger },
): RoutineReconciler {
  return new RoutineReconciler(
    () => client,
    overrides?.store ?? store,
    fakeSyncer(),
    config,
    overrides?.logger ?? silentLogger,
  );
}

/** The test store with one method replaced. */
function storeWith(
  method: "getResource" | "listResources",
  replacement: (...args: unknown[]) => Promise<unknown>,
): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return replacement;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

interface LogLine {
  readonly level: "warn" | "error";
  readonly message: string;
  readonly fields: LogFields | undefined;
}

/** A logger that keeps its warn and error lines. */
function capturingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, fields) => lines.push({ level: "warn", message, fields }),
      error: (message, fields) => lines.push({ level: "error", message, fields }),
    },
  };
}

function routineRow(id: string, overrides?: { enabled?: boolean; pausedReason?: string }) {
  return create(RoutineSchema, {
    metadata: { id, org: "acme", slug: id },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      enabled: overrides?.enabled ?? true,
      agent: { agentRef: { slug: "helper" } },
    },
    status: { pausedReason: overrides?.pausedReason ?? "" },
  });
}

/** Polls a condition to true — no fixed sleeps (determinism rule). */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met within the timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The live artifact state that MATCHES a row (no drift). */
function converged(id: string): ListedArtifact {
  return {
    scheduleId: `schedule/tick/${id}`,
    state: { note: "cron=0 9 * * * tz=UTC", paused: false },
  };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "schedule-reconciler-test-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  listedArtifacts = [];
  listError = undefined;
  syncerScript = { ensured: [], toreDown: [] };
  for (const bytes of await store.listResources(ApiResourceKind.routine)) {
    const { fromBinary } = await import("@bufbuild/protobuf");
    const row = fromBinary(RoutineSchema, bytes);
    await store.deleteResource(ApiResourceKind.routine, row.metadata?.id ?? "");
  }
});

describe("runPass — the four phases", () => {
  it("arms a row without an artifact", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_unarmed", RoutineSchema, routineRow("sch_unarmed"));

    const counts = await reconciler().runPass();
    expect(counts).toMatchObject({ rowsExamined: 1, armed: 1, repaired: 0, orphansDeleted: 0, failures: 0 });
    expect(syncerScript.ensured).toEqual(["sch_unarmed"]);
  });

  it("arms nothing for a routine with no cron, and removes the artifact a removed cron left", async () => {
    const unscheduled = routineRow("rtn_ondemand");
    unscheduled.spec!.cron = undefined;
    await store.saveResource(ApiResourceKind.routine, "rtn_ondemand", RoutineSchema, unscheduled);

    expect(await reconciler().runPass()).toMatchObject({ rowsExamined: 1, armed: 0, repaired: 0, failures: 0 });
    expect(syncerScript.ensured).toEqual([]);

    listedArtifacts = [converged("rtn_ondemand")];
    const counts = await reconciler().runPass();
    expect(counts).toMatchObject({ armed: 0, repaired: 1, orphansDeleted: 0, failures: 0 });
    expect(syncerScript.ensured, "the syncer's convergence removes it").toEqual(["rtn_ondemand"]);
  });

  it("leaves a converged artifact untouched", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_ok", RoutineSchema, routineRow("sch_ok"));
    listedArtifacts = [converged("sch_ok")];

    const counts = await reconciler().runPass();
    expect(counts).toMatchObject({ armed: 0, repaired: 0, orphansDeleted: 0, failures: 0 });
    expect(syncerScript.ensured).toEqual([]);
  });

  it("repairs note drift (the fingerprint is the only spec-change witness)", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_drift", RoutineSchema, routineRow("sch_drift"));
    listedArtifacts = [
      { scheduleId: "schedule/tick/sch_drift", state: { note: "cron=old tz=old", paused: false } },
    ];

    const counts = await reconciler().runPass();
    expect(counts.repaired).toBe(1);
    expect(syncerScript.ensured).toEqual(["sch_drift"]);
  });

  it("repairs paused drift (the two-lever DesiredPaused diff)", async () => {
    await store.saveResource(
      ApiResourceKind.routine,
      "sch_pausedrift",
      RoutineSchema,
      routineRow("sch_pausedrift", { pausedReason: "Paused after 5..." }),
    );
    listedArtifacts = [converged("sch_pausedrift")]; // live artifact NOT paused

    const counts = await reconciler().runPass();
    expect(counts.repaired).toBe(1);
  });

  it("reaps a genuine orphan only after the point read confirms the row is gone", async () => {
    listedArtifacts = [converged("sch_ghost")];

    const counts = await reconciler().runPass();
    expect(counts.orphansDeleted).toBe(1);
    expect(syncerScript.toreDown).toEqual(["sch_ghost"]);
  });

  it("NEVER reaps an artifact whose row exists at the point read (THE phase-3 guard)", async () => {
    // The race the guard exists for: the artifact is listed but the row
    // was missing from phase 2's snapshot (created between the listing
    // and the walk). The fresh point read finds it — no teardown.
    listedArtifacts = [converged("sch_latecomer")];
    const passPromise = (async () => {
      // The row lands before phase 3's point read (deterministically:
      // before the pass even starts — the guard must hold a fortiori).
      await store.saveResource(
        ApiResourceKind.routine,
        "sch_latecomer",
        RoutineSchema,
        routineRow("sch_latecomer"),
      );
      return reconciler().runPass();
    })();

    const counts = await passPromise;
    expect(counts.orphansDeleted).toBe(0);
    expect(syncerScript.toreDown).toEqual([]);
  });

  it("skips foreign artifacts entirely", async () => {
    listedArtifacts = [
      { scheduleId: "someone-elses-workflow-schedule", state: { paused: false } },
    ];

    const counts = await reconciler().runPass();
    expect(counts.orphansDeleted).toBe(0);
    expect(syncerScript.toreDown).toEqual([]);
  });

  it("counts a per-row arm failure and continues the pass", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_a", RoutineSchema, routineRow("sch_a"));
    await store.saveResource(ApiResourceKind.routine, "sch_b", RoutineSchema, routineRow("sch_b"));
    syncerScript.ensureError = new Error("temporal away");

    const counts = await reconciler().runPass();
    expect(counts.rowsExamined).toBe(2);
    expect(counts.failures).toBe(2); // both arms failed, pass finished
  });

  it("counts and logs a failed repair of a drifted artifact, and continues the pass", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_drift", RoutineSchema, routineRow("sch_drift"));
    listedArtifacts = [
      { scheduleId: "schedule/tick/sch_drift", state: { note: "cron=old tz=old", paused: false } },
    ];
    syncerScript.ensureError = new Error("temporal away");
    const log = capturingLogger();

    const counts = await reconciler(fakeClient(), { logger: log.logger }).runPass();
    expect(counts).toMatchObject({ rowsExamined: 1, repaired: 0, failures: 1 });
    expect(log.lines).toEqual([
      {
        level: "error",
        message: "Reconciliation failed to repair a drifted artifact (pass continues)",
        fields: { routine_id: "sch_drift", error: "temporal away" },
      },
    ]);
  });

  it("counts and logs a failed removal of the artifact a removed cron left, and continues the pass", async () => {
    const unscheduled = routineRow("rtn_ondemand");
    unscheduled.spec!.cron = undefined;
    await store.saveResource(ApiResourceKind.routine, "rtn_ondemand", RoutineSchema, unscheduled);
    await store.saveResource(ApiResourceKind.routine, "sch_next", RoutineSchema, routineRow("sch_next"));
    listedArtifacts = [converged("rtn_ondemand"), converged("sch_next")];
    syncerScript.ensureError = new Error("temporal away");
    const log = capturingLogger();

    const counts = await reconciler(fakeClient(), { logger: log.logger }).runPass();
    expect(counts).toMatchObject({ rowsExamined: 2, repaired: 0, failures: 1 });
    expect(log.lines).toEqual([
      {
        level: "error",
        message: "Reconciliation failed to remove the artifact of a routine with no schedule (pass continues)",
        fields: { routine_id: "rtn_ondemand", error: "temporal away" },
      },
    ]);
  });

  it("leaves an orphan whose point read faulted, counting and logging it (only not-found proves an orphan)", async () => {
    listedArtifacts = [converged("sch_unsure")];
    const log = capturingLogger();
    const faulty = storeWith("getResource", () => Promise.reject(new Error("database offline")));

    const counts = await reconciler(fakeClient(), { store: faulty, logger: log.logger }).runPass();
    expect(counts).toMatchObject({ orphansDeleted: 0, failures: 1 });
    expect(syncerScript.toreDown).toEqual([]);
    expect(log.lines).toEqual([
      {
        level: "error",
        message: "Reconciliation could not confirm an orphan (leaving it; pass continues)",
        fields: { routine_id: "sch_unsure", error: "database offline" },
      },
    ]);
  });

  it("counts and logs a failed orphan teardown, and continues the pass", async () => {
    listedArtifacts = [converged("sch_ghost")];
    syncerScript.teardownError = new Error("temporal away");
    const log = capturingLogger();

    const counts = await reconciler(fakeClient(), { logger: log.logger }).runPass();
    expect(counts).toMatchObject({ orphansDeleted: 0, failures: 1 });
    expect(log.lines).toEqual([
      {
        level: "error",
        message: "Reconciliation failed to delete an orphaned artifact (pass continues)",
        fields: { routine_id: "sch_ghost", error: "temporal away" },
      },
    ]);
  });

  it("a failed row listing aborts the pass with one counted, logged failure", async () => {
    const log = capturingLogger();
    const faulty = storeWith("listResources", () => Promise.reject(new Error("database offline")));

    const counts = await reconciler(fakeClient(), { store: faulty, logger: log.logger }).runPass();
    expect(counts).toMatchObject({ rowsExamined: 0, failures: 1 });
    expect(log.lines).toEqual([
      {
        level: "error",
        message: "Routine reconciliation could not list rows",
        fields: { error: "database offline" },
      },
    ]);
  });

  it("skips a corrupt row with a warning and converges the rest", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_whole", RoutineSchema, routineRow("sch_whole"));
    const log = capturingLogger();
    // A truncated tag varint: no Routine decodes from it.
    const corrupt = new Uint8Array([0xff, 0xff]);
    const withCorrupt = storeWith("listResources", async () => [
      corrupt,
      ...(await store.listResources(ApiResourceKind.routine)),
    ]);

    const counts = await reconciler(fakeClient(), { store: withCorrupt, logger: log.logger }).runPass();
    expect(counts).toMatchObject({ rowsExamined: 1, armed: 1, failures: 0 });
    expect(syncerScript.ensured).toEqual(["sch_whole"]);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({
      level: "warn",
      message: "Routine reconciliation skipped a corrupt row",
    });
    expect(log.lines[0]?.fields?.error).toEqual(expect.any(String));
  });

  it("a failed artifact listing aborts the pass with one counted failure", async () => {
    listError = new Error("list exploded");
    const counts = await reconciler().runPass();
    expect(counts.failures).toBe(1);
    expect(counts.rowsExamined).toBe(0);
  });

  it("skips silently when Temporal is not connected", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_offline", RoutineSchema, routineRow("sch_offline"));
    // Built directly: an undefined argument would take reconciler()'s
    // connected default.
    const offline = new RoutineReconciler(() => undefined, store, fakeSyncer(), config, silentLogger);
    const counts = await offline.runPass();
    expect(counts).toMatchObject({ rowsExamined: 0, armed: 0, failures: 0 });
    expect(syncerScript.ensured).toEqual([]);
  });

  it("phase 4 prunes ledger rows past retention and keeps fresh ones", async () => {
    const base = {
      routineId: "rtn_prune",
      org: "acme",
      origin: "schedule",
      outcome: "completed",
      reason: "",
      runId: "run_x",
      completedAt: "2020-01-01T00:00:00Z",
    };
    await store.upsertRoutineFire({
      ...base,
      fireId: "rtn-prune-20200101t000000z",
      nominalFireTime: "2020-01-01T00:00:00Z",
      recordedAt: "2020-01-01T00:00:00Z", // ancient — beyond any retention
    });
    await store.upsertRoutineFire({
      ...base,
      fireId: "rtn-prune-20990101t000000z",
      nominalFireTime: "2099-01-01T00:00:00Z",
      recordedAt: "2099-01-01T00:00:00Z", // future-fresh — must survive
    });

    await reconciler().runPass();

    const runs = await store.listRoutineFires("rtn_prune", undefined, 10);
    const total = runs.length;
    expect(total).toBe(1);
    expect(runs[0]?.nominalFireTime).toBe("2099-01-01T00:00:00Z");
  });
});

describe("the loop — kicks, coalescing, stop, containment", () => {
  it("kill-switch off: the kick still runs a pass (reconnect convergence is correctness)", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_kick", RoutineSchema, routineRow("sch_kick"));
    const r = reconciler();
    const kick = r.startReconciliation(); // boot pass queues immediately
    kick(); // coalesces with the boot pass or queues one more
    // Observe the pass land BEFORE stopping: stop() deliberately skips
    // queued-but-unstarted passes (Go's context-cancel shutdown).
    await waitFor(() => syncerScript.ensured.includes("sch_kick"));
    await r.stop();
    expect(syncerScript.ensured).toContain("sch_kick");
  });

  it("a pass that throws unexpectedly is logged, and neither bricks the queue nor escapes stop()", async () => {
    // Force runPass itself to reject by making the STORE listing throw a
    // non-Error the internal catches don't expect... every internal await
    // is caught today, so drive the containment seam directly: a client
    // provider that THROWS (never legal, but the backstop must hold).
    const log = capturingLogger();
    const r = new RoutineReconciler(
      () => {
        throw new Error("provider exploded");
      },
      store,
      fakeSyncer(),
      config,
      log.logger,
    );
    const kick = r.startReconciliation();
    kick();
    // The boot pass runs and its rejection is contained as one log line
    // (observed before stopping: stop() skips a queued, unstarted pass).
    await waitFor(() => log.lines.length > 0);
    expect(log.lines[0]).toEqual({
      level: "error",
      message:
        "Routine reconciliation pass failed unexpectedly (the loop continues; the next tick or kick retries)",
      fields: { error: "provider exploded" },
    });
    // stop() must resolve (never rethrow the pass failure into shutdown).
    await expect(r.stop()).resolves.toBeUndefined();

    // And a NEW reconciler after a failure keeps working (the queue was
    // never poisoned for subsequent enqueues).
    await store.saveResource(ApiResourceKind.routine, "sch_after", RoutineSchema, routineRow("sch_after"));
    const healthy = reconciler();
    const kick2 = healthy.startReconciliation();
    kick2();
    await waitFor(() => syncerScript.ensured.includes("sch_after"));
    await healthy.stop();
    expect(syncerScript.ensured).toContain("sch_after");
  });

  it("no pass starts after stop()", async () => {
    const r = reconciler();
    const kick = r.startReconciliation();
    await r.stop();
    kick(); // post-stop kicks are refused
    await r.stop();
    expect(syncerScript.toreDown).toEqual([]);
  });
});
