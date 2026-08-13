// A diagnostic snapshot of the settings `up` launched with, persisted as
// `startup-config.json` in the data dir and removed by `down`. Nothing in the
// CLI or daemon reads it back — it exists for humans and support tooling
// inspecting a running stack, so keep it truthful: a field that no component
// consumes does not belong here (oss#314 removed the write-only llm_* trio).
// JSON keys stay snake_case for continuity with previously-written files.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STARTUP_CONFIG_FILE } from "../constants.js";

/**
 * The persisted launch snapshot. `loadStartupConfig` parses leniently (a cast,
 * not a validator), so files written by older CLIs with extra fields — e.g.
 * the removed llm_* trio — load without migration.
 */
export interface StartupConfig {
  data_dir: string;
  log_dir: string;
  temporal_addr: string;
  execution_mode: string;
  sandbox_image: string;
  sandbox_auto_pull: boolean;
  sandbox_cleanup: boolean;
  sandbox_ttl: number;
  stigmer_server_pid: number;
  server_only: boolean;
}

/** Write the startup config into the data dir. */
export function saveStartupConfig(dataDir: string, config: StartupConfig): void {
  const path = join(dataDir, STARTUP_CONFIG_FILE);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Load the startup config from the data dir, or null if absent/unreadable. */
export function loadStartupConfig(dataDir: string): StartupConfig | null {
  const path = join(dataDir, STARTUP_CONFIG_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as StartupConfig;
  } catch {
    return null;
  }
}

/** Remove the startup config (best-effort). */
export function removeStartupConfig(dataDir: string): void {
  rmSync(join(dataDir, STARTUP_CONFIG_FILE), { force: true });
}
