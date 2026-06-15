// The daemon's health snapshot, written atomically by the supervisor and read
// by `stigmer status`.
//
// It is the single consistent view of every managed component. The supervisor
// is the only writer; status (and any other reader) only reads. JSON keys are
// snake_case to match the file the Go daemon writes, so the format is stable
// across the migration.

import { readFileSync, renameSync, writeFileSync } from "node:fs";

export type ComponentLifecycle = "running" | "stopped" | "failed" | "unhealthy";

/** Runtime state of a single managed component. */
export interface ComponentState {
  pid: number;
  state: ComponentLifecycle;
  started_at: string;
  restart_count: number;
  last_error?: string;
  /** For components that announce readiness (the runner's "polling" marker):
   * true once observed. Absent for components without a readiness signal. */
  ready?: boolean;
}

/** The full snapshot persisted to `health-state.json`. */
export interface HealthState {
  daemon_pid: number;
  started_at: string;
  components: Record<string, ComponentState>;
}

/**
 * Write the health state atomically: serialize to a temp file then rename over
 * the target, so a reader never observes a half-written snapshot.
 */
export function writeHealthState(path: string, state: HealthState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** Load the health state, or null if it is missing or unparseable. */
export function loadHealthState(path: string): HealthState | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as HealthState;
  } catch {
    return null;
  }
}
