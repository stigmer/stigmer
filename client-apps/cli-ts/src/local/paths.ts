// Filesystem layout for the local stack, built on the CLI's config paths.
//
// The Go CLI deliberately splits state across two roots and the TS port
// preserves it exactly:
//   - the *data dir* (~/.stigmer/data) holds daemon/server/runner PID + state +
//     logs + the runner workspace;
//   - the *config dir* (~/.stigmer) holds config.yaml, the SQLite db, and the
//     Temporal binary/data/lock.
// Centralizing the asymmetry here keeps every call site honest. Each helper
// takes the home dir (defaulting to os.homedir()) so tests can redirect the
// whole tree to a temp directory.

import { homedir } from "node:os";
import { join } from "node:path";
import { configDir, dataDir } from "../config/paths.js";

export { configDir, dataDir };

/** Daemon/server/runner/temporal log directory (~/.stigmer/data/logs). */
export function logDir(home: string = homedir()): string {
  return join(dataDir(home), "logs");
}

/** Working directory the runner is launched in (~/.stigmer/data/workspace). */
export function workspaceDir(home: string = homedir()): string {
  return join(dataDir(home), "workspace");
}

/** Downloaded-binary directory for Temporal + stigmer-server (~/.stigmer/bin). */
export function binDir(home: string = homedir()): string {
  return join(configDir(home), "bin");
}

/**
 * Root for on-demand-acquired npm runtimes (~/.stigmer/runtimes). Each release
 * version installs into its own `<version>/` subtree so multiple CLI versions can
 * coexist and a partial install never poisons another version's runner.
 */
export function runtimesDir(home: string = homedir()): string {
  return join(configDir(home), "runtimes");
}

/** Temporal dev-server data directory (~/.stigmer/temporal-data). */
export function temporalDataDir(home: string = homedir()): string {
  return join(configDir(home), "temporal-data");
}

/** Temporal PID file (~/.stigmer/temporal.pid). Lives in the config dir, not
 * the data dir — matching the Go CLI's Temporal manager layout. */
export function temporalPidFile(home: string = homedir()): string {
  return join(configDir(home), "temporal.pid");
}

/** Temporal single-instance lock file (~/.stigmer/temporal.lock). */
export function temporalLockFile(home: string = homedir()): string {
  return join(configDir(home), "temporal.lock");
}

/** Local SQLite database path (~/.stigmer/stigmer.db), the server's default. */
export function databasePath(home: string = homedir()): string {
  return join(configDir(home), "stigmer.db");
}

/** Server artifact storage path (~/.stigmer/storage), the server's default. */
export function storagePath(home: string = homedir()): string {
  return join(configDir(home), "storage");
}
