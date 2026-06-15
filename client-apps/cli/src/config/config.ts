// CLI configuration model and persistence (~/.stigmer/config.yaml).
//
// Parity + coexistence: the file format matches the Go CLI exactly (snake_case
// keys, 0600 perms, doc-link header) so a single config works whether invoked
// through the Go or TS CLI during the migration. Crucially, the local-backend
// section (daemon/LLM/Temporal settings owned by later waves and the Go CLI) is
// carried through opaquely on save, so the TS CLI never drops fields it does
// not yet model.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { isStandalone } from "../runtime.js";
import { configPath } from "./paths.js";

export type BackendType = "local" | "cloud";

/** Cloud backend connection. Property names are snake_case to serialize to the
 * exact YAML keys the Go CLI reads/writes. */
export interface CloudBackendConfig {
  endpoint?: string;
  token?: string;
  org_id?: string;
  env_id?: string;
  // Refresh-token support is new in the TS CLI (the Go CLI persists only the
  // access token). These ride alongside the access token so the CLI can refresh
  // silently instead of forcing re-login every hour. Interop note: the Go CLI
  // models cloud config as a fixed struct and will drop these two fields if it
  // re-saves the file — acceptable during the migration that retires it.
  refresh_token?: string;
  token_expiry?: string;
}

export interface BackendConfig {
  type: BackendType;
  /** Local daemon/LLM/Temporal settings — opaque to the TS CLI in Wave 1,
   * preserved verbatim across save so coexisting tools keep their config. */
  local?: unknown;
  cloud?: CloudBackendConfig;
}

export interface ContextConfig {
  organization?: string;
}

export interface Config {
  backend: BackendConfig;
  context?: ContextConfig;
}

const SAVE_HEADER = `# Stigmer CLI Configuration
# For configuration options and examples, see:
# https://github.com/stigmer/stigmer/blob/main/docs/cli/configuration.md

`;

/** The default config: local backend, no daemon settings fabricated. */
export function getDefault(): Config {
  return { backend: { type: "local" } };
}

/**
 * Load the config from disk. In standalone mode the file is ignored and the
 * default is returned, isolating sidecar/automation invocations from ambient
 * user config (matches the Go CLI). A missing file also yields the default.
 */
export function load(path: string = configPath()): Config {
  if (isStandalone()) {
    return getDefault();
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (isNotFound(err)) return getDefault();
    throw err;
  }

  const parsed = parseYaml(raw) as Partial<Config> | null;
  return normalize(parsed);
}

/** Persist the config to disk (0600 file in a 0755 directory), with the
 * documentation header the Go CLI writes. */
export function save(config: Config, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  const body = stringifyYaml(stripUndefined(config));
  writeFileSync(path, SAVE_HEADER + body, { mode: 0o600 });
}

/** True when the cloud backend is selected. */
export function isCloudMode(config: Config): boolean {
  return config.backend.type === "cloud";
}

function normalize(parsed: Partial<Config> | null): Config {
  if (parsed === null || parsed.backend === undefined) {
    return getDefault();
  }
  const type: BackendType = parsed.backend.type === "cloud" ? "cloud" : "local";
  return {
    backend: { type, local: parsed.backend.local, cloud: parsed.backend.cloud },
    context: parsed.context,
  };
}

// Recursively drop undefined-valued keys so the serialized YAML omits empty
// optionals (matching Go's yaml omitempty), while preserving the opaque local
// section untouched.
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) out[key] = stripUndefined(val);
    }
    return out as T;
  }
  return value;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}
