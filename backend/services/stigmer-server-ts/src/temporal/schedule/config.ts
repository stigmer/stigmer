/**
 * Schedule-clock configuration — ports
 * pkg/domain/schedule/temporal/config.go.
 *
 * Environment variables deliberately share the STIGMER_SCHEDULES_* names
 * with the cloud edition, so test harnesses and runbooks use one
 * vocabulary. There is deliberately NO interval-floor knob: the floor is a
 * platform guardrail for a shared metered system, enforced by cloud's
 * pre-persist probe; OSS is one user on their own machine and has no probe
 * (DD-015 D-A) — a present-but-ignored knob would be a lie.
 *
 * Config lives with the clock, not the domain (sub-project decision 1,
 * owner-ratified): every reader is clock-side — the agentexecution
 * precedent of a domain-local config was driven by a domain-step consumer
 * (oss#397) that schedule does not have.
 */

export class ScheduleTemporalConfig {
  constructor(
    /**
     * Task queue for the tick workflow and its activities. Dedicated (not
     * the agent-execution queue) so a spanning tick can never starve agent
     * executions. Default: schedule_stigmer.
     */
    readonly stigmerQueue: string,
    /**
     * Baked into every artifact's policy: how far back Temporal fires
     * missed ticks after downtime (the laptop that slept through 9am).
     * Default: 60.
     */
    readonly catchupWindowMinutes: number,
    /**
     * The artifact's baked workflow run timeout — a backstop, not policy
     * (the tracking budget is the policy). Default: 24.
     */
    readonly tickRunTimeoutHours: number,
    /** The auto-pause threshold (DD-008 D7). Default: 5. */
    readonly maxConsecutiveFailures: number,
    /**
     * One fire's tracking budget — under overlap SKIP, literally the
     * maximum time one hung run may silence a schedule. Clamped at fire
     * time (resolvedRunTrackingTimeoutMinutes). Default: 60.
     */
    readonly runTrackingTimeoutMinutes: number,
    /**
     * Gates the periodic convergence pass (the reconnect-triggered pass
     * always runs — it is correctness, not hygiene, on an ephemeral dev
     * server). Default: true.
     */
    readonly reconciliationEnabled: boolean,
    /** The periodic pass cadence. Default: 5. */
    readonly reconciliationIntervalMinutes: number,
    /**
     * Bounds each scheduled run's tool rounds (0 disables the bound). An
     * unattended runaway burns the user's own API budget with nobody
     * watching — worse than an interactive one. Default: 20 (the cloud
     * profile's value).
     */
    readonly executionProfileMaxToolRounds: number,
    /**
     * Bounds each scheduled run's spend, enforced by the shared runner
     * (0 disables). Default: 1.00.
     */
    readonly executionProfileMaxCostUsd: number,
    /**
     * Bounds the fire ledger (DD-017 D-7): rows recorded earlier than this
     * are pruned by the reconciliation pass. Default: 90 (a quarter of
     * monthly reminder cycles — run history is a product surface, not
     * delivery plumbing).
     */
    readonly runHistoryRetentionDays: number,
  ) {}

  /**
   * Clamps the tracking budget to at least 1 minute and at least one hour
   * inside the baked artifact run timeout — the cloud edition's exact
   * clamp, so a misconfigured budget cannot outlive the tick that carries
   * it (Go ResolvedRunTrackingTimeoutMinutes).
   */
  resolvedRunTrackingTimeoutMinutes(): number {
    let ceiling = (this.tickRunTimeoutHours - 1) * 60;
    if (ceiling < 1) {
      ceiling = 1;
    }
    let resolved = this.runTrackingTimeoutMinutes;
    if (resolved > ceiling) {
      resolved = ceiling;
    }
    if (resolved < 1) {
      resolved = 1;
    }
    return resolved;
  }

  /**
   * Floors the pause threshold at 1 — a zero/negative threshold would
   * pause on configuration, not on failure (Go
   * ResolvedMaxConsecutiveFailures).
   */
  resolvedMaxConsecutiveFailures(): number {
    return this.maxConsecutiveFailures < 1 ? 1 : this.maxConsecutiveFailures;
  }

  /**
   * Floors the fire-ledger retention at 1 day — zero/negative would prune
   * history as it lands (Go ResolvedRunHistoryRetentionDays).
   */
  resolvedRunHistoryRetentionDays(): number {
    return this.runHistoryRetentionDays < 1 ? 1 : this.runHistoryRetentionDays;
  }
}

/** Loads configuration from environment variables (Go LoadConfig). */
export function newScheduleConfigFromEnv(): ScheduleTemporalConfig {
  return new ScheduleTemporalConfig(
    getEnv("TEMPORAL_SCHEDULE_STIGMER_TASK_QUEUE", "schedule_stigmer"),
    getEnvInt("STIGMER_SCHEDULES_CATCHUP_WINDOW_MINUTES", 60),
    getEnvInt("STIGMER_SCHEDULES_TICK_RUN_TIMEOUT_HOURS", 24),
    getEnvInt("STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES", 5),
    getEnvInt("STIGMER_SCHEDULES_RUN_TRACKING_TIMEOUT_MINUTES", 60),
    getEnvBool("STIGMER_SCHEDULES_RECONCILIATION_ENABLED", true),
    getEnvInt("STIGMER_SCHEDULES_RECONCILIATION_INTERVAL_MINUTES", 5),
    getEnvInt("STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_TOOL_ROUNDS", 20),
    getEnvFloat("STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_COST_USD", 1.0),
    getEnvInt("STIGMER_SCHEDULES_RUN_HISTORY_RETENTION_DAYS", 90),
  );
}

function getEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : defaultValue;
}

/**
 * Go strconv.Atoi parity: only a plain (optionally signed) integer parses;
 * anything else silently keeps the default, exactly Go's getEnvInt.
 */
function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === "" || !/^[+-]?\d+$/.test(value)) {
    return defaultValue;
  }
  return Number.parseInt(value, 10);
}

/**
 * Go strconv.ParseBool parity: exactly 1/t/T/TRUE/true/True and the 0/f
 * family parse; anything else keeps the default.
 */
function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  if (["1", "t", "T", "TRUE", "true", "True"].includes(value)) {
    return true;
  }
  if (["0", "f", "F", "FALSE", "false", "False"].includes(value)) {
    return false;
  }
  return defaultValue;
}

/** Go strconv.ParseFloat parity: a finite float parses, else the default. */
function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
