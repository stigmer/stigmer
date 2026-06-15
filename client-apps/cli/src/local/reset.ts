// `stigmer reset` — stop the stack and wipe all persistent local state, so the
// next `up` starts from a clean slate. Configuration (config.yaml) is preserved
// by default so users do not lose API keys; `includeConfig` removes it too.
//
// The set of removed paths is a faithful port of the Go CLI's reset, spanning
// both roots of the `~/.stigmer` layout (the SQLite db + Temporal state under
// the config dir, and everything under the data dir).

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configPath } from "../config/paths.js";
import {
  binDir,
  configDir,
  databasePath,
  dataDir,
  storagePath,
  temporalDataDir,
  temporalLockFile,
  temporalPidFile,
} from "./paths.js";
import { down, isRunning } from "./daemon/launch.js";

export interface ResetOptions {
  /** Also remove config.yaml (the user must reconfigure on next start). */
  includeConfig?: boolean;
}

export interface ResetResult {
  servicesStopped: boolean;
  removedPaths: string[];
}

/** Stop the stack if running. Returns whether anything was stopped. Injectable
 * so reset's file-wiping can be tested without touching a real daemon. */
export type StopFn = (home: string) => Promise<boolean>;

const defaultStop: StopFn = async (home) => {
  if (!(await isRunning(home))) return false;
  await down(home);
  return true;
};

/** Stop services (if running) and remove persistent state under `home`. */
export async function reset(
  options: ResetOptions = {},
  home: string = homedir(),
  stop: StopFn = defaultStop,
): Promise<ResetResult> {
  const servicesStopped = await stop(home);

  const config = configDir(home);
  const db = databasePath(home);

  // Order: db (+ sidecars) first, then the data tree, then config-dir state.
  const targets = [
    db,
    `${db}-wal`,
    `${db}-shm`,
    dataDir(home),
    storagePath(home),
    join(config, "sessions"),
    join(config, "runtimes"),
    temporalDataDir(home),
    temporalPidFile(home),
    temporalLockFile(home),
    binDir(home),
    join(config, "logs"),
    join(config, "llm.pid"),
  ];

  const removedPaths: string[] = [];
  for (const target of targets) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removedPaths.push(target);
    }
  }

  if (options.includeConfig === true) {
    const cfg = configPath(home);
    if (existsSync(cfg)) {
      rmSync(cfg, { force: true });
      removedPaths.push(cfg);
    }
  }

  return { servicesStopped, removedPaths };
}
