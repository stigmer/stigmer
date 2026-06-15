// Public surface of the Temporal subsystem.

export { DEFAULT_TEMPORAL_VERSION, downloadTemporalCli, extractTarEntry, isTemporalInstalled } from "./download.js";
export { isLikelyTemporal, processCommandLine } from "./inspect.js";
export { TemporalManager, type TemporalManagerOptions } from "./manager.js";
export { type SupervisedTarget, type SupervisorOptions, TemporalSupervisor } from "./supervisor.js";
