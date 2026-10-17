/**
 * Pins the tick activities against Go's tick_activities_test.go: the
 * record-tick revalidation matrix (deleted/disabled/paused decline, and a
 * routine whose cron was removed while its artifact lingers), the start-run
 * re-validation collapse to SKIPPED (and its no-ledger-row deleted arm),
 * the schedule fire handed to the run starter and its ledger row keyed by
 * the fire's id, phase classification incl. GONE, the idempotent success
 * reset, and the ONE-closure failure record — increment, threshold latch
 * (first pause's copy never rewritten), next_fire_at clear, the timed-out
 * ledger verdict, and the best-effort artifact re-sync exactly at the
 * crossing, whose failure is logged and never fails the verdict. A fire
 * ledger write that fails is logged and never fails its activity. A row
 * with no status yet gets one materialized by the fire's stamp, and every
 * store fault other than not-found fails its activity with an error
 * naming the write it was making, so Temporal retries it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { LogFields, Logger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { createRoutineTickActivities } from "../activities.js";
import type { RoutineTickActivityDeps } from "../activities.js";
import { RoutineTemporalConfig } from "../config.js";
import {
  FAILURE_RUN_FAILED,
  FAILURE_RUN_TIMED_OUT,
  FAILURE_START_FAILED,
  PHASE_CANCELLED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  PHASE_GONE,
  PHASE_RUNNING,
  PHASE_TERMINATED,
  RECORD_FAILED_RUN_ACTIVITY_NAME,
  RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME,
  RECORD_TICK_ACTIVITY_NAME,
  POLL_EXECUTION_PHASE_ACTIVITY_NAME,
  RUN_REFUSED,
  RUN_SKIPPED,
  RUN_STARTED,
  START_SCHEDULED_RUN_ACTIVITY_NAME,
  TICK_FIRED,
  TICK_SKIPPED_AUTO_PAUSED,
  TICK_SKIPPED_DELETED,
  TICK_SKIPPED_DISABLED,
  TICK_SKIPPED_UNSCHEDULED,
} from "../names.js";
import { scheduleFire } from "../run-starter.js";
import type { RoutineFireRequest, RunOutcomeResult } from "../run-starter.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const NOMINAL = "2026-08-25T09:30:00Z";

let dir: string;
let store: SqliteStore;

// Threshold 2 (the conformance execution targets' pin) makes the latch
// provable in two failures.
const config = new RoutineTemporalConfig("schedule_stigmer", 60, 24, 2, 60, true, 5, 20, 1.0, 90);

let peekResult: Date | undefined;
let peekError: Error | undefined;
let ensureCalls: string[];
let ensureError: Error | undefined;
let startRunOutcome: RunOutcomeResult;
let startedFires: RoutineFireRequest[];

function activities(overrides?: { store?: Store; logger?: Logger }) {
  const deps: RoutineTickActivityDeps = {
    store: overrides?.store ?? store,
    config,
    logger: overrides?.logger ?? silentLogger,
    syncer: {
      peekNextFireAt: async () => {
        if (peekError !== undefined) {
          throw peekError;
        }
        return peekResult;
      },
      ensureAndRecord: async (routine) => {
        ensureCalls.push(routine.metadata?.id ?? "");
        if (ensureError !== undefined) {
          throw ensureError;
        }
        return undefined;
      },
    },
    runStarter: {
      startRun: async (_routine, fire) => {
        startedFires.push(fire);
        return startRunOutcome;
      },
    },
  };
  return createRoutineTickActivities(deps);
}

/** The test store with one method rejecting as a database fault would (never not-found). */
function faulting(
  method: "getResource" | "updateResource" | "upsertRoutineFire" | "markLatestRoutineFireTerminal",
): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("database offline"));
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

function routineRow(overrides?: { enabled?: boolean; pausedReason?: string; failures?: number }) {
  return create(RoutineSchema, {
    metadata: { id: "sch_01act", org: "acme", slug: "daily" },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      enabled: overrides?.enabled ?? true,
      agent: { agentRef: { slug: "helper" } },
    },
    status: {
      pausedReason: overrides?.pausedReason ?? "",
      consecutiveFailures: overrides?.failures ?? 0,
    },
  });
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tick-activities-test-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  peekResult = undefined;
  peekError = undefined;
  ensureCalls = [];
  ensureError = undefined;
  startRunOutcome = { kind: "started", runId: "run_01x", alreadyExisted: false };
  startedFires = [];
  await store.deleteResource(ApiResourceKind.routine, "sch_01act");
  await store.deleteRoutineFiresByRoutine("sch_01act");
});

describe("recordTick — the revalidation matrix", () => {
  it("declines a deleted row (orphaned artifact fires are harmless by construction)", async () => {
    const outcome = await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(outcome).toBe(TICK_SKIPPED_DELETED);
  });

  it("declines an owner-disabled row", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ enabled: false }));
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_SKIPPED_DISABLED);
  });

  it("declines a platform-paused row", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ pausedReason: "Paused after 2..." }));
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_SKIPPED_AUTO_PAUSED);
  });

  it("declines a routine whose cron was removed while its artifact still ticks", async () => {
    const unscheduled = routineRow();
    unscheduled.spec!.cron = undefined;
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, unscheduled);
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_SKIPPED_UNSCHEDULED);
  });

  it("fires a live row: stamps last_fire_at = NOMINAL and refreshes next_fire_at", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    peekResult = new Date("2026-08-26T09:30:00Z");
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_FIRED);

    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.lastFireAt?.seconds).toBe(BigInt(Date.parse(NOMINAL) / 1000));
    expect(row.status?.nextFireAt?.seconds).toBe(BigInt(Date.parse("2026-08-26T09:30:00Z") / 1000));
    expect(row.status?.audit?.statusAudit?.event).toBe("updated");
  });

  it("a failed next-fire refresh never blocks recording the fire", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    peekError = new Error("temporal is away");
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_FIRED);
    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.lastFireAt).toBeDefined();
    expect(row.status?.nextFireAt).toBeUndefined();
  });

  it("a row with no status yet gets one materialized by the fire's stamp", async () => {
    const statusless = routineRow();
    statusless.status = undefined;
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, statusless);
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_FIRED);
    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.lastFireAt?.seconds).toBe(BigInt(Date.parse(NOMINAL) / 1000));
  });

  it("a store fault reading the row fails the activity, naming the routine, so Temporal retries it", async () => {
    await expect(
      activities({ store: faulting("getResource") })[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL),
    ).rejects.toThrow("load routine sch_01act: database offline");
  });

  it("a store fault writing the fire fails the activity, naming the status write", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    await expect(
      activities({ store: faulting("updateResource") })[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL),
    ).rejects.toThrow("record routine fire on status: database offline");
  });
});

describe("startScheduledRun — re-validation and the ledger", () => {
  it("collapses a row disabled between record and start into SKIPPED, with a ledger row", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ enabled: false }));
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_SKIPPED);
    // The budget rides the RESULT even on skips (replay-safe timing).
    expect(result.trackingTimeoutMinutes).toBe(60);
    const total = (await store.listRoutineFires("sch_01act", undefined, 10)).length;
    expect(total).toBe(1); // the skip left its ledger row (row exists)
  });

  it("collapses a routine that lost its cron between record and start into SKIPPED", async () => {
    const unscheduled = routineRow();
    unscheduled.spec!.cron = undefined;
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, unscheduled);
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_SKIPPED);
    expect(startedFires).toEqual([]);
  });

  it("the deleted-row skip leaves NO ledger row (the cascade already ran)", async () => {
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_SKIPPED);
    const total = (await store.listRoutineFires("sch_01act", undefined, 10)).length;
    expect(total).toBe(0);
  });

  it("a started run writes the non-terminal schedule ledger row, keyed by the schedule fire's id", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_STARTED);
    expect(result.executionId).toBe("run_01x");
    expect(startedFires).toEqual([scheduleFire("sch_01act", new Date(NOMINAL))]);
    const runs = await store.listRoutineFires("sch_01act", undefined, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.outcome).toBe("started");
    expect(runs[0]?.origin).toBe("schedule");
    expect(runs[0]?.fireId).toBe("sch-01act-20260825t093000z");
    expect(runs[0]?.runId).toBe("run_01x");
    expect(runs[0]?.firedBy, "nobody fired a schedule's own fire").toBeUndefined();
    expect(runs[0]?.completedAt).toBe("");
  });

  it("a refused run writes a terminal ledger row with the 'run refused: ' prefix", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    startRunOutcome = { kind: "refused", reason: "gate said no" };
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_REFUSED);
    expect(result.failureReason).toBe("run refused: gate said no");
    const runs = await store.listRoutineFires("sch_01act", undefined, 10);
    expect(runs[0]?.outcome).toBe("refused");
    expect(runs[0]?.reason).toBe("run refused: gate said no");
    expect(runs[0]?.completedAt).not.toBe("");
  });

  it("a store fault reading the row fails the activity rather than skipping the fire", async () => {
    await expect(
      activities({ store: faulting("getResource") })[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL),
    ).rejects.toThrow("load routine sch_01act: database offline");
    expect(startedFires).toEqual([]);
  });

  it("a fire-ledger row that cannot be written is logged and never fails the started run", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    const log = capturingLogger();
    const result = await activities({ store: faulting("upsertRoutineFire"), logger: log.logger })[
      START_SCHEDULED_RUN_ACTIVITY_NAME
    ]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_STARTED);
    expect(result.executionId).toBe("run_01x");
    expect(log.lines).toEqual([
      {
        level: "warn",
        message: "Fire-ledger row not written (best-effort — the run itself is unaffected)",
        fields: {
          routine_id: "sch_01act",
          fire_id: "sch-01act-20260825t093000z",
          outcome: "started",
          error: "database offline",
        },
      },
    ]);
  });
});

describe("pollExecutionPhase — one row read, GONE distinct from RUNNING", () => {
  it.each([
    [RunPhase.RUN_COMPLETED, PHASE_COMPLETED],
    [RunPhase.RUN_CANCELLED, PHASE_CANCELLED],
    [RunPhase.RUN_TERMINATED, PHASE_TERMINATED],
    [RunPhase.RUN_FAILED, PHASE_FAILED],
    [RunPhase.RUN_IN_PROGRESS, PHASE_RUNNING],
    [RunPhase.RUN_PENDING, PHASE_RUNNING],
  ])("classifies phase %d as %s", async (phase, want) => {
    await store.saveResource(
      ApiResourceKind.run,
      "aex_01poll",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "aex_01poll", org: "acme" },
        status: { phase },
      }),
    );
    expect(await activities()[POLL_EXECUTION_PHASE_ACTIVITY_NAME]("aex_01poll")).toBe(want);
  });

  it("a deleted row answers GONE (a deleted run must not brick its schedule)", async () => {
    expect(await activities()[POLL_EXECUTION_PHASE_ACTIVITY_NAME]("aex_missing")).toBe(PHASE_GONE);
  });
});

describe("recordSuccessfulRun — the absorbing zero", () => {
  it("resets the streak, marks the cron ledger verdict, and is idempotent", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ failures: 1 }));
    await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);

    await activities()[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act");
    let row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.consecutiveFailures).toBe(0);
    const runs = await store.listRoutineFires("sch_01act", undefined, 10);
    expect(runs[0]?.outcome).toBe("completed");

    // Retried freely: a second call is harmless.
    await activities()[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act");
    row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.consecutiveFailures).toBe(0);
  });

  it("a deleted row is a silent no-op", async () => {
    await expect(activities()[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act")).resolves.toBeUndefined();
  });

  it("a fire-ledger verdict that cannot be written is logged and never fails the reset", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ failures: 1 }));
    const log = capturingLogger();
    await activities({ store: faulting("markLatestRoutineFireTerminal"), logger: log.logger })[
      RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME
    ]("sch_01act");
    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.consecutiveFailures).toBe(0);
    expect(log.lines).toEqual([
      {
        level: "warn",
        message: "Fire-ledger verdict not written (best-effort — the streak write is unaffected)",
        fields: { routine_id: "sch_01act", outcome: "completed", error: "database offline" },
      },
    ]);
  });

  it("a store fault fails the reset, naming the routine, so the retried write lands", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ failures: 1 }));
    await expect(
      activities({ store: faulting("updateResource") })[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act"),
    ).rejects.toThrow("reset failure streak on routine sch_01act: database offline");
  });
});

describe("recordFailedRun — the one-closure verdict", () => {
  it("increments below the threshold without latching", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "run aex_01x ended failed", FAILURE_RUN_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 1, paused: false });
    expect(ensureCalls).toEqual([]); // no crossing → no re-sync
  });

  it("latches the pause with the byte-pinned copy exactly at the crossing and clears next_fire_at", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ failures: 1 }));
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "run aex_01x ended failed", FAILURE_RUN_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 2, paused: true });

    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.pausedReason).toBe(
      "Paused after 2 consecutive failed runs. Last failure: run aex_01x ended failed",
    );
    expect(row.status?.nextFireAt).toBeUndefined();
    // The crossing triggers the best-effort immediate artifact re-sync.
    expect(ensureCalls).toEqual(["sch_01act"]);
  });

  it("never rewrites the first pause's copy past the threshold", async () => {
    await store.saveResource(
      ApiResourceKind.routine,
      "sch_01act",
      RoutineSchema,
      routineRow({ failures: 2, pausedReason: "Paused after 2 consecutive failed runs. Last failure: original" }),
    );
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "a newer failure", FAILURE_RUN_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 3, paused: true });
    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.pausedReason).toContain("original");
    expect(ensureCalls).toEqual([]); // already latched — not a crossing
  });

  it("a deleted row answers the zero post-image (deleting must never resurrect)", async () => {
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "x", FAILURE_START_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 0, paused: false });
  });

  it("marks the cron ledger verdict for tracked failures but not for START_FAILED", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);

    await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "run aex_01x ended failed", FAILURE_RUN_FAILED);
    const runs = await store.listRoutineFires("sch_01act", undefined, 10);
    expect(runs[0]?.outcome).toBe("failed");
    expect(runs[0]?.reason).toBe("run aex_01x ended failed");
  });

  it("marks the timed_out ledger verdict for a run that outlived its tracking budget", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);

    const reason = "run run_01x did not finish within 60 minutes";
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", reason, FAILURE_RUN_TIMED_OUT);
    expect(recorded).toEqual({ consecutiveFailures: 1, paused: false });
    const runs = await store.listRoutineFires("sch_01act", undefined, 10);
    expect(runs[0]?.outcome).toBe("timed_out");
    expect(runs[0]?.reason).toBe(reason);
    expect(runs[0]?.completedAt).not.toBe("");
  });

  it("a failed artifact re-sync at the crossing is logged and never fails the verdict (reconciliation pauses it)", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow({ failures: 1 }));
    ensureError = new Error("temporal is away");
    const log = capturingLogger();

    const recorded = await activities({ logger: log.logger })[RECORD_FAILED_RUN_ACTIVITY_NAME](
      "sch_01act",
      "run aex_01x ended failed",
      FAILURE_RUN_FAILED,
    );

    expect(recorded).toEqual({ consecutiveFailures: 2, paused: true });
    expect(ensureCalls).toEqual(["sch_01act"]);
    expect(log.lines.filter((line) => line.level === "error")).toEqual([
      {
        level: "error",
        message: "Paused routine's artifact not yet converged (the reconciliation pass will pause it)",
        fields: { routine_id: "sch_01act", error: "temporal is away" },
      },
    ]);
  });

  it("a store fault fails the verdict, naming the routine, and writes no streak", async () => {
    await store.saveResource(ApiResourceKind.routine, "sch_01act", RoutineSchema, routineRow());
    await expect(
      activities({ store: faulting("updateResource") })[RECORD_FAILED_RUN_ACTIVITY_NAME](
        "sch_01act",
        "run aex_01x ended failed",
        FAILURE_RUN_FAILED,
      ),
    ).rejects.toThrow("record failed run on routine sch_01act: database offline");
    const row = await store.getResource(ApiResourceKind.routine, "sch_01act", RoutineSchema);
    expect(row.status?.consecutiveFailures).toBe(0);
  });
});
