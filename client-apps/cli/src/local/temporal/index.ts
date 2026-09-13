// Public surface of the Temporal subsystem.

export {
  DEFAULT_TEMPORAL_VERSION,
  TEMPORAL_CHECKSUMS_FILE,
  downloadTemporalCli,
  extractTarEntry,
  isTemporalInstalled,
  temporalArchiveName,
  temporalReleaseAssetUrl,
} from "./download.js";
export { isLikelyTemporal, processCommandLine, type ProcessInspectOptions } from "./inspect.js";
export { TEMPORAL_BIN_ENV, TemporalManager, type TemporalManagerOptions } from "./manager.js";
export { type SupervisedTarget, type SupervisorOptions, TemporalSupervisor } from "./supervisor.js";
