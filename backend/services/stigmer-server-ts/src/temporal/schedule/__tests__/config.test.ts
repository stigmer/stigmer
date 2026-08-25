/**
 * Pins the config clamps and env parsing against Go's config.go: the
 * tracking-budget ceiling (one hour inside the run timeout), the
 * threshold and retention floors, and Go's strict strconv parsing
 * (malformed values keep the default, never NaN).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ScheduleTemporalConfig, newScheduleConfigFromEnv } from "../config.js";

const ENV_KEYS = [
  "TEMPORAL_SCHEDULE_STIGMER_TASK_QUEUE",
  "STIGMER_SCHEDULES_CATCHUP_WINDOW_MINUTES",
  "STIGMER_SCHEDULES_TICK_RUN_TIMEOUT_HOURS",
  "STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES",
  "STIGMER_SCHEDULES_RUN_TRACKING_TIMEOUT_MINUTES",
  "STIGMER_SCHEDULES_RECONCILIATION_ENABLED",
  "STIGMER_SCHEDULES_RECONCILIATION_INTERVAL_MINUTES",
  "STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_TOOL_ROUNDS",
  "STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_COST_USD",
  "STIGMER_SCHEDULES_RUN_HISTORY_RETENTION_DAYS",
];

// Snapshot-and-restore rather than delete-and-hope: the invoking shell may
// legitimately carry STIGMER_SCHEDULES_* values, and a test must neither
// fail on them nor destroy them for the rest of the worker process.
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
  }
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function config(overrides: Partial<Record<"timeout" | "tracking" | "threshold" | "retention", number>>) {
  return new ScheduleTemporalConfig(
    "schedule_stigmer",
    60,
    overrides.timeout ?? 24,
    overrides.threshold ?? 5,
    overrides.tracking ?? 60,
    true,
    5,
    20,
    1.0,
    overrides.retention ?? 90,
  );
}

describe("defaults from an empty environment", () => {
  it("loads the documented defaults", () => {
    const c = newScheduleConfigFromEnv();
    expect(c.stigmerQueue).toBe("schedule_stigmer");
    expect(c.catchupWindowMinutes).toBe(60);
    expect(c.tickRunTimeoutHours).toBe(24);
    expect(c.maxConsecutiveFailures).toBe(5);
    expect(c.runTrackingTimeoutMinutes).toBe(60);
    expect(c.reconciliationEnabled).toBe(true);
    expect(c.reconciliationIntervalMinutes).toBe(5);
    expect(c.executionProfileMaxToolRounds).toBe(20);
    expect(c.executionProfileMaxCostUsd).toBe(1.0);
    expect(c.runHistoryRetentionDays).toBe(90);
  });
});

describe("env parsing — Go strconv parity", () => {
  it("reads well-formed overrides", () => {
    process.env.STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES = "2";
    process.env.STIGMER_SCHEDULES_RECONCILIATION_ENABLED = "false";
    process.env.STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_COST_USD = "0.5";
    const c = newScheduleConfigFromEnv();
    expect(c.maxConsecutiveFailures).toBe(2);
    expect(c.reconciliationEnabled).toBe(false);
    expect(c.executionProfileMaxCostUsd).toBe(0.5);
  });

  it("keeps the default on a malformed int (Go Atoi failure)", () => {
    process.env.STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES = "two";
    expect(newScheduleConfigFromEnv().maxConsecutiveFailures).toBe(5);
  });

  it("keeps the default on a non-ParseBool token (Go ParseBool failure)", () => {
    process.env.STIGMER_SCHEDULES_RECONCILIATION_ENABLED = "no";
    expect(newScheduleConfigFromEnv().reconciliationEnabled).toBe(true);
  });
});

describe("resolvedRunTrackingTimeoutMinutes — the cloud edition's exact clamp", () => {
  it("passes an in-range budget through", () => {
    expect(config({}).resolvedRunTrackingTimeoutMinutes()).toBe(60);
  });
  it("caps at one hour inside the baked run timeout", () => {
    expect(config({ timeout: 2, tracking: 600 }).resolvedRunTrackingTimeoutMinutes()).toBe(60);
  });
  it("floors at 1 minute", () => {
    expect(config({ tracking: 0 }).resolvedRunTrackingTimeoutMinutes()).toBe(1);
    expect(config({ tracking: -5 }).resolvedRunTrackingTimeoutMinutes()).toBe(1);
  });
  it("a degenerate run timeout still yields a 1-minute ceiling", () => {
    expect(config({ timeout: 1, tracking: 60 }).resolvedRunTrackingTimeoutMinutes()).toBe(1);
  });
});

describe("threshold and retention floors", () => {
  it("floors the pause threshold at 1 (never pause on configuration)", () => {
    expect(config({ threshold: 0 }).resolvedMaxConsecutiveFailures()).toBe(1);
    expect(config({ threshold: -3 }).resolvedMaxConsecutiveFailures()).toBe(1);
    expect(config({ threshold: 5 }).resolvedMaxConsecutiveFailures()).toBe(5);
  });
  it("floors the ledger retention at 1 day (never prune history as it lands)", () => {
    expect(config({ retention: 0 }).resolvedRunHistoryRetentionDays()).toBe(1);
    expect(config({ retention: 90 }).resolvedRunHistoryRetentionDays()).toBe(90);
  });

  it("floors the reconciliation interval at 1 minute (a zero would hot-loop where Go panics)", () => {
    const zero = new ScheduleTemporalConfig("q", 60, 24, 5, 60, true, 0, 20, 1.0, 90);
    expect(zero.resolvedReconciliationIntervalMinutes()).toBe(1);
    const five = new ScheduleTemporalConfig("q", 60, 24, 5, 60, true, 5, 20, 1.0, 90);
    expect(five.resolvedReconciliationIntervalMinutes()).toBe(5);
  });
});
