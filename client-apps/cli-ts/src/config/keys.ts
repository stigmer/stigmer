// Dotted-key access for the generic `config get|set|list` commands. Only the
// fields the TS CLI owns in Wave 1 are exposed; daemon/local settings are
// managed by their own (later) commands and preserved opaquely on save.

import { UsageError } from "../errors/usage-error.js";
import type { BackendType, Config } from "./config.js";

interface ConfigKey {
  /** Stored (non-resolved) value, "" when unset. */
  get(config: Config): string;
  /** Validate and apply the value, creating sub-objects as needed. */
  set(config: Config, value: string): void;
}

const KEYS: Record<string, ConfigKey> = {
  "backend.type": {
    get: (config) => config.backend.type,
    set: (config, value) => {
      if (value !== "local" && value !== "cloud") {
        throw new UsageError(`invalid backend.type "${value}" (expected: local, cloud)`);
      }
      config.backend.type = value as BackendType;
    },
  },
  "backend.cloud.endpoint": {
    get: (config) => config.backend.cloud?.endpoint ?? "",
    set: (config, value) => {
      (config.backend.cloud ??= {}).endpoint = value;
    },
  },
  "backend.cloud.org_id": {
    get: (config) => config.backend.cloud?.org_id ?? "",
    set: (config, value) => {
      (config.backend.cloud ??= {}).org_id = value;
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

export function setConfigValue(config: Config, key: string, value: string): void {
  const entry = KEYS[key];
  if (entry === undefined) throw new UsageError(unknownKeyMessage(key));
  entry.set(config, value);
}

function unknownKeyMessage(key: string): string {
  return `unknown config key "${key}" (known keys: ${configKeyNames().join(", ")})`;
}
