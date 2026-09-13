// Public surface of the daemon subsystem.

export { buildComponents, buildRunnerEnv, buildServerEnv } from "./components.js";
export { type DaemonConfig, type DaemonEnvInputs, DaemonEnvVar, buildDaemonEnv, readDaemonConfig } from "./env.js";
export { NodeProcessHost, type NodeProcessHostOptions, type OutputMirror, systemClock } from "./host.js";
export { down, isRunning, type UpForegroundDeps, type UpOptions, up, upForeground } from "./launch.js";
export { type InternalDaemonDeps, type TemporalControl, runInternalDaemon, waitForShutdownSignal } from "./process.js";
export {
  HEALTH_CHECK_INTERVAL_MS,
  MAX_RESTARTS,
  MAX_UNHEALTHY_CHECKS,
  ProcessSupervisor,
  RAPID_CRASH_WINDOW_MS,
  SETTLE_DELAY_MS,
  type StartResult,
  type SupervisorDeps,
} from "./supervisor.js";
export type { ChildHandle, Clock, ComponentSpec, ExitInfo, ProcessHost, ReadinessGate, SpawnRequest } from "./types.js";
