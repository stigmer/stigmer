// CLI configuration model and persistence (~/.stigmer/config.yaml).
//
// Named backends ("a named backend without a credential story is half a
// feature"): the `backends` map + `current_backend` are the
// kubectl-context model — each entry carries its own endpoint AND its own
// credentials, so switching between Stigmer Cloud and a self-hosted server
// never clobbers either side's login state. Two names are reserved:
// "local" (the managed daemon, never stored in the map — its endpoint and
// no-auth posture are fixed) and "cloud" (where `stigmer auth login` lands
// by default).
//
// The `backend.local` section (daemon/LLM/Temporal settings owned by the
// local-mode modules) is carried through verbatim, so a save never drops a key
// this module does not model.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { UsageError } from "../errors/index.js";
import { isStandalone } from "../runtime.js";
import { configPath } from "./paths.js";

/** The two named-backend families: Stigmer Cloud, or any OSS server. */
export type NamedBackendType = "cloud" | "selfhost";

/** The reserved name of the managed local daemon backend. */
export const LOCAL_BACKEND_NAME = "local";

/** The reserved name `stigmer auth login` targets from local mode. */
export const CLOUD_BACKEND_NAME = "cloud";

/**
 * One named backend: endpoint + its own credentials. Property names are
 * snake_case to keep the YAML in the file's established dialect.
 *
 * Credential lanes by type:
 *   - cloud: the OAuth token set (token / refresh_token / token_expiry),
 *     written by `stigmer auth login` and rotated by the token provider.
 *   - selfhost: `api_key` — a server-minted `stk_` token
 *     (`stigmer apikey create`). Browser login against self-hosted
 *     issuers is deliberately not modeled here; the API token is the
 *     self-host credential story.
 */
export interface NamedBackendConfig {
  type: NamedBackendType;
  endpoint?: string;
  token?: string;
  org_id?: string;
  env_id?: string;
  refresh_token?: string;
  token_expiry?: string;
  api_key?: string;
}

export interface BackendConfig {
  /** Local daemon/LLM/Temporal settings — opaque to this module,
   * preserved verbatim across save so the local-mode modules keep their config. */
  local?: unknown;
}

export interface ContextConfig {
  /** The context organization's id (or, set by hand, whatever value was given). */
  org?: string;
  /** Its slug when `context set` stored it, for output; never sent to the server. */
  org_slug?: string;
}

/**
 * One added plugin marketplace as the file spells it. The `marketplace`
 * commands are the only writer; the shape is kept loose here and narrowed by
 * `src/marketplace/config.ts`, so a hand-edited entry this CLI cannot read is
 * reported by `stigmer marketplace list` instead of being dropped on the next
 * save. The official marketplace is built in and never stored. `type` is the
 * discriminator, the word this file already uses for backends.
 */
export interface MarketplaceEntryConfig {
  type?: string;
  /** GitHub `owner/repo` for `type: github`. */
  repo?: string;
  /** Branch, tag or commit for `type: github`; the default branch when absent. */
  ref?: string;
  /** Absolute directory for `type: local`. */
  path?: string;
}

export interface Config {
  backend: BackendConfig;
  backends?: Record<string, NamedBackendConfig>;
  current_backend?: string;
  context?: ContextConfig;
  /** Added plugin marketplaces, keyed by the name a user installs from. */
  marketplaces?: Record<string, MarketplaceEntryConfig>;
}

const SAVE_HEADER = `# Stigmer CLI Configuration
# For configuration options and examples, see:
# https://github.com/stigmer/stigmer/blob/main/docs/cli/configuration.md

`;

/** The default config: the local backend, no daemon settings fabricated. */
export function getDefault(): Config {
  return {
    backend: {},
    backends: {},
    current_backend: LOCAL_BACKEND_NAME,
  };
}

/**
 * Load the config from disk. In standalone mode the file is ignored and the
 * default is returned, isolating sidecar/automation invocations from ambient
 * user config. A missing file also yields the default.
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

/**
 * Persist the config to disk (0600 file in a 0755 directory), with the
 * documentation header. A pristine local config (no named backends) writes no
 * backend keys at all.
 */
export function save(config: Config, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  const body = stringifyYaml(stripUndefined(serializable(config)));
  writeFileSync(path, SAVE_HEADER + body, { mode: 0o600 });
}

/** The active backend's name (normalize always stamps current_backend). */
export function activeBackendName(config: Config): string {
  const name = config.current_backend ?? "";
  return name === "" ? LOCAL_BACKEND_NAME : name;
}

/**
 * The active backend: the reserved local daemon (entry undefined) or a
 * named entry. A current_backend naming a missing entry is a loud
 * configuration error, never a silent fallback — the config was edited by
 * hand or a remove left it dangling.
 */
export function activeBackend(config: Config): {
  name: string;
  entry: NamedBackendConfig | undefined;
} {
  const name = activeBackendName(config);
  if (name === LOCAL_BACKEND_NAME) {
    return { name, entry: undefined };
  }
  const entry = config.backends?.[name];
  if (entry === undefined) {
    throw new UsageError(
      `current backend "${name}" does not exist — run 'stigmer config backend list' and 'stigmer config backend use <name>'`,
    );
  }
  return { name, entry };
}

/** True when the active backend is Stigmer Cloud. */
export function isCloudMode(config: Config): boolean {
  return activeBackend(config).entry?.type === "cloud";
}

function normalize(parsed: Partial<Config> | null): Config {
  if (parsed === null || typeof parsed !== "object") {
    return getDefault();
  }

  const current =
    typeof parsed.current_backend === "string" && parsed.current_backend !== ""
      ? parsed.current_backend
      : LOCAL_BACKEND_NAME;

  return {
    backend: { local: parsed.backend?.local },
    backends: normalizeBackends(parsed.backends),
    current_backend: current,
    context: parsed.context,
    marketplaces: normalizeMarketplaces(parsed.marketplaces),
  };
}

/** Object-valued entries verbatim; anything else is not a marketplace and is dropped. */
function normalizeMarketplaces(
  parsed: Record<string, MarketplaceEntryConfig> | undefined,
): Record<string, MarketplaceEntryConfig> | undefined {
  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const marketplaces: Record<string, MarketplaceEntryConfig> = {};
  for (const [name, entry] of Object.entries(parsed)) {
    if (entry === null || typeof entry !== "object") continue;
    marketplaces[name] = { ...entry };
  }
  return Object.keys(marketplaces).length === 0 ? undefined : marketplaces;
}

function normalizeBackends(
  parsed: Record<string, NamedBackendConfig> | undefined,
): Record<string, NamedBackendConfig> {
  const backends: Record<string, NamedBackendConfig> = {};
  if (parsed === undefined || typeof parsed !== "object") {
    return backends;
  }
  for (const [name, entry] of Object.entries(parsed)) {
    if (entry === null || typeof entry !== "object") continue;
    backends[name] = {
      ...entry,
      type: entry.type === "cloud" ? "cloud" : "selfhost",
    };
  }
  return backends;
}

/** The on-disk shape, minimal for defaults. */
function serializable(config: Config): Partial<Config> {
  const backends = config.backends ?? {};
  const current = activeBackendName(config);
  const pristineLocal =
    Object.keys(backends).length === 0 && current === LOCAL_BACKEND_NAME;
  return {
    ...(config.backend.local === undefined
      ? {}
      : { backend: { local: config.backend.local } }),
    ...(pristineLocal ? {} : { backends, current_backend: current }),
    context: config.context,
    marketplaces: config.marketplaces,
  };
}

// Recursively drop undefined-valued keys so the serialized YAML omits empty
// optionals, while preserving the opaque local
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
