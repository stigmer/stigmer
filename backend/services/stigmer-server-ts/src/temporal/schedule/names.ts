/**
 * Schedule-clock Temporal wire identifiers and the tick's outcome
 * vocabulary — ports the constants of pkg/domain/schedule/temporal
 * (artifact.go, tick_activities.go).
 *
 * Every value here is a byte-pinned cross-repo wire constant: the cloud
 * Java ScheduleArtifact, the integration harness's ScheduleInspector, and
 * both server editions address artifacts, workflows, and activities by
 * these exact strings — changing one on any side strands every existing
 * artifact. The outcome vocabulary rides Temporal's JSON data converter
 * into recorded histories, so the STRING VALUES and the RunStart /
 * FailureRecorded FIELD NAMES are replay contract too.
 *
 * Imported by BOTH the workflow bundle and host code — no node built-ins,
 * no framework imports (the workflow-bundle import discipline).
 */

/**
 * The tick workflow's registered type and the artifact-id prefix's stem
 * (Go TickWorkflowType). The artifact's baked action starts this exact
 * type name — a rename would fail every fire with "workflow type not
 * found".
 */
export const TICK_WORKFLOW_TYPE = "schedule/tick";

/**
 * Prefixes each Schedule resource's Temporal Schedule artifact id:
 * schedule/tick/{scheduleResourceId} (Go TickIDPrefix).
 */
export const TICK_ID_PREFIX = `${TICK_WORKFLOW_TYPE}/`;

/**
 * The cloud write-path's throwaway fire-time probes (Go probeIDPrefix).
 * OSS never creates probes (no pre-persist probe — DD-015 D-A), but the
 * reconciler skips the prefix defensively so a shared/dev namespace never
 * gets its probes treated as tick orphans.
 */
export const PROBE_ID_PREFIX = "schedule/probe/";

/** The Temporal Schedule artifact id for a Schedule resource id. */
export function artifactId(scheduleResourceId: string): string {
  return TICK_ID_PREFIX + scheduleResourceId;
}

/** Inverts artifactId. */
export function resourceIdOf(artifactIdValue: string): string {
  return artifactIdValue.startsWith(TICK_ID_PREFIX)
    ? artifactIdValue.slice(TICK_ID_PREFIX.length)
    : artifactIdValue;
}

// ─── Activity names ─────────────────────────────────────────────────────
// Slash-namespaced like the platform's other Go-owned system activities,
// registered by the schedule worker under these exact names.

export const RECORD_TICK_ACTIVITY_NAME = "stigmer/schedule/record-tick";
export const START_SCHEDULED_RUN_ACTIVITY_NAME = "stigmer/schedule/start-run";
export const POLL_EXECUTION_PHASE_ACTIVITY_NAME =
  "stigmer/schedule/poll-phase";
export const RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME =
  "stigmer/schedule/record-success";
export const RECORD_FAILED_RUN_ACTIVITY_NAME =
  "stigmer/schedule/record-failure";

// ─── The tick's outcome vocabulary ──────────────────────────────────────
// String-typed so the JSON data converter serializes them stably across
// releases; the VALUES mirror the cloud edition's enums name-for-name
// (one runbook, two editions) — Go tick_activities.go.

/** recordTick's verdict on whether this fire proceeds (Go TickOutcome). */
export type TickOutcome =
  | "FIRED"
  | "SKIPPED_DELETED"
  | "SKIPPED_DISABLED"
  | "SKIPPED_AUTO_PAUSED";

export const TICK_FIRED = "FIRED" satisfies TickOutcome;
export const TICK_SKIPPED_DELETED = "SKIPPED_DELETED" satisfies TickOutcome;
export const TICK_SKIPPED_DISABLED = "SKIPPED_DISABLED" satisfies TickOutcome;
export const TICK_SKIPPED_AUTO_PAUSED = "SKIPPED_AUTO_PAUSED" satisfies TickOutcome;

/** startScheduledRun's verdict on the run start (Go RunOutcome). */
export type RunOutcome =
  | "STARTED"
  | "ALREADY_STARTED"
  | "SKIPPED"
  | "TARGET_MISSING"
  | "REFUSED";

export const RUN_STARTED = "STARTED" satisfies RunOutcome;
export const RUN_ALREADY_STARTED = "ALREADY_STARTED" satisfies RunOutcome;
export const RUN_SKIPPED = "SKIPPED" satisfies RunOutcome;
export const RUN_TARGET_MISSING = "TARGET_MISSING" satisfies RunOutcome;
export const RUN_REFUSED = "REFUSED" satisfies RunOutcome;

/** The tracked execution's observed phase class (Go RunPhase). */
export type RunPhase =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TERMINATED"
  | "GONE";

export const PHASE_RUNNING = "RUNNING" satisfies RunPhase;
export const PHASE_COMPLETED = "COMPLETED" satisfies RunPhase;
export const PHASE_FAILED = "FAILED" satisfies RunPhase;
export const PHASE_CANCELLED = "CANCELLED" satisfies RunPhase;
export const PHASE_TERMINATED = "TERMINATED" satisfies RunPhase;
export const PHASE_GONE = "GONE" satisfies RunPhase;

/** Which path fed the streak, for the log line (Go FailureKind). */
export type FailureKind = "START_FAILED" | "RUN_FAILED" | "RUN_TIMED_OUT";

export const FAILURE_START_FAILED = "START_FAILED" satisfies FailureKind;
export const FAILURE_RUN_FAILED = "RUN_FAILED" satisfies FailureKind;
export const FAILURE_RUN_TIMED_OUT = "RUN_TIMED_OUT" satisfies FailureKind;

/**
 * startScheduledRun's full answer (Go RunStart). The tracking budget rides
 * the activity RESULT so workflow timing derives from recorded history — a
 * config flip can never confuse an in-flight replay. Field names are the
 * recorded-history JSON contract (Go's json tags), never rename.
 */
export interface RunStart {
  outcome: RunOutcome;
  /** Set exactly when outcome ∈ {STARTED, ALREADY_STARTED}. */
  executionId: string;
  /** This fire's tracking budget, already clamped. */
  trackingTimeoutMinutes: number;
  /**
   * The deterministic start-failure copy when outcome ∈ {TARGET_MISSING,
   * REFUSED}.
   */
  failureReason: string;
}

/** recordFailedRun's post-image summary (Go FailureRecorded). */
export interface FailureRecorded {
  consecutiveFailures: number;
  paused: boolean;
}

/**
 * The activity surface the tick workflow proxies, keyed by the pinned
 * slash names (the TS SDK registers and invokes activities by object key).
 */
export interface ScheduleTickActivities {
  [RECORD_TICK_ACTIVITY_NAME]: (
    scheduleResourceId: string,
    nominalFireTimeRfc3339: string,
  ) => Promise<TickOutcome>;
  [START_SCHEDULED_RUN_ACTIVITY_NAME]: (
    scheduleResourceId: string,
    nominalFireTimeRfc3339: string,
  ) => Promise<RunStart>;
  [POLL_EXECUTION_PHASE_ACTIVITY_NAME]: (
    executionId: string,
  ) => Promise<RunPhase>;
  [RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]: (
    scheduleResourceId: string,
  ) => Promise<void>;
  [RECORD_FAILED_RUN_ACTIVITY_NAME]: (
    scheduleResourceId: string,
    reason: string,
    kind: FailureKind,
  ) => Promise<FailureRecorded>;
}
