// Configuration captured at `up` time so the daemon can restart components with
// the same settings the user launched with. Persisted as `startup-config.json`
// in the data dir; JSON keys are snake_case to match the Go CLI's file.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STARTUP_CONFIG_FILE } from "../constants.js";

/** The persisted launch configuration. Mirrors the Go `StartupConfig` struct. */
export interface StartupConfig {
  data_dir: string;
  log_dir: string;
  temporal_addr: string;
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
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
