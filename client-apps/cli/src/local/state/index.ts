// Public surface of the local-stack state primitives.

export { type ComponentLifecycle, type ComponentState, type HealthState, loadHealthState, writeHealthState } from "./health-state.js";
export { type FileLock, acquireLock } from "./lock.js";
export { DEFAULT_LOG_RETENTION_DAYS, cleanupOldLogs, rotateLogs } from "./log-rotation.js";
export { readPidFile, removePidFile, writePidFile } from "./pidfile.js";
export { findProcessByPort, isProcessAlive, killProcess, killProcessGroup } from "./proc.js";
export { type StartupConfig, loadStartupConfig, removeStartupConfig, saveStartupConfig } from "./startup-config.js";
