// Filesystem locations for CLI configuration and local data. Mirrors the Go
// CLI's config path helpers (~/.stigmer/...). Functions take the home dir as a
// parameter (defaulting to os.homedir()) so tests can redirect them cleanly.

import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR_NAME = ".stigmer";
export const CONFIG_FILE_NAME = "config.yaml";
export const DEFAULT_DATA_DIR = "data";

/** Absolute path to the config directory (~/.stigmer). */
export function configDir(home: string = homedir()): string {
  return join(home, CONFIG_DIR_NAME);
}

/** Absolute path to the config file (~/.stigmer/config.yaml). */
export function configPath(home: string = homedir()): string {
  return join(configDir(home), CONFIG_FILE_NAME);
}

/** Absolute path to the local backend data directory (~/.stigmer/data). */
export function dataDir(home: string = homedir()): string {
  return join(configDir(home), DEFAULT_DATA_DIR);
}
