// Dotted-key access for the generic `config get|set|list` commands. Only the
// fields the TS CLI owns in Wave 1 are exposed; daemon/local settings are
// managed by their own (later) commands and preserved opaquely on save.

import { UsageError } from "../errors/usage-error.js";
import {
  CLOUD_BACKEND_NAME,
  type Config,
  LOCAL_BACKEND_NAME,
  activeBackendName,
} from "./config.js";

interface ConfigKey {
  /** Stored (non-resolved) value, "" when unset. */
  get(config: Config): string;
  /** Validate and apply the value, creating sub-objects as needed. */
  set(config: Config, value: string): void;
}

// The backend.cloud.* keys predate named backends and remain the documented
// kv surface for the reserved "cloud" entry; `current_backend` is the named
// model's own key. `backend.type` stays the simple local/cloud switch
// (named backends switch through `config backend use`).
const KEYS: Record<string, ConfigKey> = {
  "backend.type": {
    get: (config) =>
      activeBackendName(config) === LOCAL_BACKEND_NAME ? "local" : "cloud",
    set: (config, value) => {
      if (value !== "local" && value !== "cloud") {
        throw new UsageError(
          `invalid backend.type "${value}" (expected: local, cloud)`,
        );
      }
      if (value === "cloud") {
        (config.backends ??= {})[CLOUD_BACKEND_NAME] ??= { type: "cloud" };
        config.current_backend = CLOUD_BACKEND_NAME;
      } else {
        config.current_backend = LOCAL_BACKEND_NAME;
      }
    },
  },
  current_backend: {
    get: (config) => activeBackendName(config),
    set: (config, value) => {
      if (
        value !== LOCAL_BACKEND_NAME &&
        config.backends?.[value] === undefined
      ) {
        throw new UsageError(
          `unknown backend "${value}" (add it first: stigmer config backend add)`,
        );
      }
      config.current_backend = value;
    },
  },
  "backend.cloud.endpoint": {
    get: (config) => config.backends?.[CLOUD_BACKEND_NAME]?.endpoint ?? "",
    set: (config, value) => {
      const backends = (config.backends ??= {});
      (backends[CLOUD_BACKEND_NAME] ??= { type: "cloud" }).endpoint = value;
    },
  },
  "backend.cloud.org_id": {
    get: (config) => config.backends?.[CLOUD_BACKEND_NAME]?.org_id ?? "",
    set: (config, value) => {
      const backends = (config.backends ??= {});
      (backends[CLOUD_BACKEND_NAME] ??= { type: "cloud" }).org_id = value;
    },
  },
  "context.organization": {
    get: (config) => config.context?.organization ?? "",
    set: (config, value) => {
      (config.context ??= {}).organization = value;
    },
  },
};

/** All known config keys, sorted, for `config list` and error messages. */
export function configKeyNames(): string[] {
  return Object.keys(KEYS).sort();
}

export function getConfigValue(config: Config, key: string): string {
  const entry = KEYS[key];
  if (entry === undefined) throw new UsageError(unknownKeyMessage(key));
  return entry.get(config);
}

export function setConfigValue(
  config: Config,
  key: string,
  value: string,
): void {
  const entry = KEYS[key];
  if (entry === undefined) throw new UsageError(unknownKeyMessage(key));
  entry.set(config, value);
}

function unknownKeyMessage(key: string): string {
  return `unknown config key "${key}" (known keys: ${configKeyNames().join(", ")})`;
}
