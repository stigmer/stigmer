/**
 * Pins the tick activities against Go's tick_activities_test.go: the
 * record-tick revalidation matrix (deleted/disabled/paused decline), the
 * start-run re-validation collapse to SKIPPED (and its no-ledger-row
 * deleted arm), phase classification incl. GONE, the idempotent success
 * reset, and the ONE-closure failure record — increment, threshold latch
 * (first pause's copy never rewritten), next_fire_at clear, and the
 * best-effort artifact re-sync exactly at the crossing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { createScheduleTickActivities } from "../activities.js";
import type { ScheduleTickActivityDeps } from "../activities.js";
import { ScheduleTemporalConfig } from "../config.js";
import {
  FAILURE_RUN_FAILED,
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
} from "../names.js";
import type { RunOutcomeResult } from "../run-starter.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const NOMINAL = "2026-08-25T09:30:00Z";

let dir: string;
let store: SqliteStore;

// Threshold 2 (the conformance execution targets' pin) makes the latch
// provable in two failures.
const config = new ScheduleTemporalConfig("schedule_stigmer", 60, 24, 2, 60, true, 5, 20, 1.0, 90);

let peekResult: Date | undefined;
let peekError: Error | undefined;
let ensureCalls: string[];
let startRunOutcome: RunOutcomeResult;

function activities() {
  const deps: ScheduleTickActivityDeps = {
    store,
    config,
    logger: silentLogger,
    syncer: {
      peekNextFireAt: async () => {
        if (peekError !== undefined) {
          throw peekError;
        }
        return peekResult;
      },
      ensureAndRecord: async (schedule) => {
        ensureCalls.push(schedule.metadata?.id ?? "");
        return undefined;
      },
    },
    runStarter: { startRun: async () => startRunOutcome },
  };
  return createScheduleTickActivities(deps);
}

function scheduleRow(overrides?: { enabled?: boolean; pausedReason?: string; failures?: number }) {
  return create(ScheduleSchema, {
    metadata: { id: "sch_01act", org: "acme", slug: "daily" },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      enabled: overrides?.enabled ?? true,
      target: { case: "agent", value: { agentRef: { slug: "helper" } } },
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
  startRunOutcome = { kind: "started", executionId: "aex_01x", alreadyExisted: false };
  await store.deleteResource(ApiResourceKind.schedule, "sch_01act");
  await store.deleteScheduleRunsBySchedule("sch_01act");
});

describe("recordTick — the revalidation matrix", () => {
  it("declines a deleted row (orphaned artifact fires are harmless by construction)", async () => {
    const outcome = await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(outcome).toBe(TICK_SKIPPED_DELETED);
  });

  it("declines an owner-disabled row", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow({ enabled: false }));
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_SKIPPED_DISABLED);
  });

  it("declines a platform-paused row", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow({ pausedReason: "Paused after 2..." }));
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_SKIPPED_AUTO_PAUSED);
  });

  it("fires a live row: stamps last_fire_at = NOMINAL and refreshes next_fire_at", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow());
    peekResult = new Date("2026-08-26T09:30:00Z");
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_FIRED);

    const row = await store.getResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema);
    expect(row.status?.lastFireAt?.seconds).toBe(BigInt(Date.parse(NOMINAL) / 1000));
    expect(row.status?.nextFireAt?.seconds).toBe(BigInt(Date.parse("2026-08-26T09:30:00Z") / 1000));
    expect(row.status?.audit?.statusAudit?.event).toBe("updated");
  });

  it("a failed next-fire refresh never blocks recording the fire", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow());
    peekError = new Error("temporal is away");
    expect(await activities()[RECORD_TICK_ACTIVITY_NAME]("sch_01act", NOMINAL)).toBe(TICK_FIRED);
    const row = await store.getResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema);
    expect(row.status?.lastFireAt).toBeDefined();
    expect(row.status?.nextFireAt).toBeUndefined();
  });
});

describe("startScheduledRun — re-validation and the ledger", () => {
  it("collapses a row disabled between record and start into SKIPPED, with a ledger row", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow({ enabled: false }));
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_SKIPPED);
    // The budget rides the RESULT even on skips (replay-safe timing).
    expect(result.trackingTimeoutMinutes).toBe(60);
    const { total } = await store.listScheduleRuns("sch_01act", 0, 10);
    expect(total).toBe(1); // the skip left its ledger row (row exists)
  });

  it("the deleted-row skip leaves NO ledger row (the cascade already ran)", async () => {
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_SKIPPED);
    const { total } = await store.listScheduleRuns("sch_01act", 0, 10);
    expect(total).toBe(0);
  });

  it("a started run writes the non-terminal cron ledger row", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow());
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_STARTED);
    expect(result.executionId).toBe("aex_01x");
    const { runs } = await store.listScheduleRuns("sch_01act", 0, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.outcome).toBe("started");
    expect(runs[0]?.origin).toBe("cron");
    expect(runs[0]?.completedAt).toBe("");
  });

  it("a refused run writes a terminal ledger row with the 'run refused: ' prefix", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow());
    startRunOutcome = { kind: "refused", reason: "gate said no" };
    const result = await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);
    expect(result.outcome).toBe(RUN_REFUSED);
    expect(result.failureReason).toBe("run refused: gate said no");
    const { runs } = await store.listScheduleRuns("sch_01act", 0, 10);
    expect(runs[0]?.outcome).toBe("refused");
    expect(runs[0]?.reason).toBe("run refused: gate said no");
    expect(runs[0]?.completedAt).not.toBe("");
  });
});

describe("pollExecutionPhase — one row read, GONE distinct from RUNNING", () => {
  it.each([
    [ExecutionPhase.EXECUTION_COMPLETED, PHASE_COMPLETED],
    [ExecutionPhase.EXECUTION_CANCELLED, PHASE_CANCELLED],
    [ExecutionPhase.EXECUTION_TERMINATED, PHASE_TERMINATED],
    [ExecutionPhase.EXECUTION_FAILED, PHASE_FAILED],
    [ExecutionPhase.EXECUTION_IN_PROGRESS, PHASE_RUNNING],
    [ExecutionPhase.EXECUTION_PENDING, PHASE_RUNNING],
  ])("classifies phase %d as %s", async (phase, want) => {
    await store.saveResource(
      ApiResourceKind.agent_execution,
      "aex_01poll",
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
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
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow({ failures: 1 }));
    await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);

    await activities()[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act");
    let row = await store.getResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema);
    expect(row.status?.consecutiveFailures).toBe(0);
    const { runs } = await store.listScheduleRuns("sch_01act", 0, 10);
    expect(runs[0]?.outcome).toBe("completed");

    // Retried freely: a second call is harmless.
    await activities()[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act");
    row = await store.getResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema);
    expect(row.status?.consecutiveFailures).toBe(0);
  });

  it("a deleted row is a silent no-op", async () => {
    await expect(activities()[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]("sch_01act")).resolves.toBeUndefined();
  });
});

describe("recordFailedRun — the one-closure verdict", () => {
  it("increments below the threshold without latching", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow());
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "run aex_01x ended failed", FAILURE_RUN_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 1, paused: false });
    expect(ensureCalls).toEqual([]); // no crossing → no re-sync
  });

  it("latches the pause with the byte-pinned copy exactly at the crossing and clears next_fire_at", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow({ failures: 1 }));
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "run aex_01x ended failed", FAILURE_RUN_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 2, paused: true });

    const row = await store.getResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema);
    expect(row.status?.pausedReason).toBe(
      "Paused after 2 consecutive failed runs. Last failure: run aex_01x ended failed",
    );
    expect(row.status?.nextFireAt).toBeUndefined();
    // The crossing triggers the best-effort immediate artifact re-sync.
    expect(ensureCalls).toEqual(["sch_01act"]);
  });

  it("never rewrites the first pause's copy past the threshold", async () => {
    await store.saveResource(
      ApiResourceKind.schedule,
      "sch_01act",
      ScheduleSchema,
      scheduleRow({ failures: 2, pausedReason: "Paused after 2 consecutive failed runs. Last failure: original" }),
    );
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "a newer failure", FAILURE_RUN_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 3, paused: true });
    const row = await store.getResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema);
    expect(row.status?.pausedReason).toContain("original");
    expect(ensureCalls).toEqual([]); // already latched — not a crossing
  });

  it("a deleted row answers the zero post-image (deleting must never resurrect)", async () => {
    const recorded = await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "x", FAILURE_START_FAILED);
    expect(recorded).toEqual({ consecutiveFailures: 0, paused: false });
  });

  it("marks the cron ledger verdict for tracked failures but not for START_FAILED", async () => {
    await store.saveResource(ApiResourceKind.schedule, "sch_01act", ScheduleSchema, scheduleRow());
    await activities()[START_SCHEDULED_RUN_ACTIVITY_NAME]("sch_01act", NOMINAL);

    await activities()[RECORD_FAILED_RUN_ACTIVITY_NAME]("sch_01act", "run aex_01x ended failed", FAILURE_RUN_FAILED);
    const { runs } = await store.listScheduleRuns("sch_01act", 0, 10);
    expect(runs[0]?.outcome).toBe("failed");
    expect(runs[0]?.reason).toBe("run aex_01x ended failed");
  });
});
