// Cross-cutting constants for the local-stack orchestration subsystem.
//
// These are the values that must stay identical across the foreground launcher,
// the supervised daemon, the Temporal manager, and the status/logs commands.
// Keeping them in one module is what lets a coding agent change a port or a
// queue name in exactly one place and trust that server-dispatch and
// runner-poll can never drift.

/**
 * Port `stigmer-server` listens on (gRPC).
 *
 * This is also the web console's origin: the server serves the
 * console's static export on this same unified port (lane 4) — one
 * process, one origin, no CORS hop.
 */
export const SERVER_PORT = 7234;

/** Temporal frontend gRPC port (dev server default). */
export const TEMPORAL_PORT = 7233;

/** Temporal Web UI port. */
export const TEMPORAL_UI_PORT = 8233;

/** Temporal namespace the local stack uses end-to-end. */
export const TEMPORAL_NAMESPACE = "default";

/**
 * The Temporal task queue the unified runner polls and the server dispatches
 * to. This is the single source of truth, pinned identically on both the
 * launched server and the runner so they can never diverge.
 */
export const RUNNER_TASK_QUEUE = "stigmer_runner";

/**
 * The marker the unified runner prints on stdout once its Temporal worker is
 * actually polling. Two existing harnesses (`test/conformance`, `test/e2e`)
 * already depend on it; the daemon uses it to report truthful runner readiness
 * rather than mere process liveness.
 */
export const RUNNER_READY_MARKER = "Worker ready, polling for tasks";

/** PID file names (live under the data dir; see `paths.ts`). */
export const DAEMON_PID_FILE = "daemon.pid";
export const SERVER_PID_FILE = "stigmer-server.pid";
export const RUNNER_PID_FILE = "runner.pid";

/** State file names (live under the data dir). */
export const HEALTH_STATE_FILE = "health-state.json";
export const STARTUP_CONFIG_FILE = "startup-config.json";
