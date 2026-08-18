// Typed view over `backend.local.operator` — the self-hosted operator
// identity `setup` persists and the launcher delivers to the server child
// (oss#796, the UX-completion arm of oss#400's configured operator identity).
//
// The lens pattern mirrors llm-config.ts: config/config.ts carries
// `backend.local` verbatim so unknown siblings are never dropped; this module
// owns exactly one sub-tree (`local.operator`) and resolves the effective
// identity with env-override precedence (STIGMER_OPERATOR_EMAIL >
// config file). Sources never mix: an env-provided email brings the
// env-provided name (or none), a config-provided email brings the config
// name — half-and-half identities would be attribution lies.
//
// Validation deliberately duplicates the server's boot check
// (stigmer-server pkg/config/config.go loadOperatorIdentity): trim both
// values; a non-empty email must contain '@' (nothing more — the server is
// equally minimal on purpose); a name without an email is refused because
// the email IS the identity. Checking here surfaces the failure at setup
// time instead of at the next `stigmer up`.

import type { Config } from "../config/config.js";

/** Operator identity as persisted under `backend.local.operator` (snake_case = YAML keys). */
export interface OperatorSettings {
  email?: string;
  name?: string;
}

interface LocalSection {
  operator?: OperatorSettings;
  [key: string]: unknown;
}

function localSection(config: Config): LocalSection {
  const local = config.backend.local;
  return local !== null && typeof local === "object" ? (local as LocalSection) : {};
}

/** The persisted operator settings, if any. */
export function readOperator(config: Config): OperatorSettings | undefined {
  return localSection(config).operator;
}

/**
 * Effective operator identity: env > config file, sources never mixed.
 * Returns `undefined` when neither source provides an email (the anonymous
 * default oss#400 preserves).
 */
export function resolveOperatorIdentity(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): OperatorSettings | undefined {
  const envEmail = (env.STIGMER_OPERATOR_EMAIL ?? "").trim();
  if (envEmail !== "") {
    const envName = (env.STIGMER_OPERATOR_NAME ?? "").trim();
    return envName === "" ? { email: envEmail } : { email: envEmail, name: envName };
  }
  const persisted = readOperator(config);
  const email = (persisted?.email ?? "").trim();
  if (email === "") return undefined;
  const name = (persisted?.name ?? "").trim();
  return name === "" ? { email } : { email, name };
}

/**
 * Validate an operator identity the way the server's boot check will
 * (byte-similar messages so setup-time and boot-time failures read as one
 * rule). Returns an error message, or undefined when valid. An empty email
 * with an empty name is valid — it means "no identity", the wizard's skip.
 */
export function validateOperatorIdentity(email: string, name: string): string | undefined {
  const trimmedEmail = email.trim();
  const trimmedName = name.trim();
  if (trimmedEmail !== "" && !trimmedEmail.includes("@")) {
    return `"${trimmedEmail}" is not an email address (missing '@')`;
  }
  if (trimmedName !== "" && trimmedEmail === "") {
    return "an operator name without an email is not an identity — set both or neither";
  }
  return undefined;
}

/**
 * Return a copy of `config` with the operator section replaced, preserving
 * every other key under `backend.local`. Passing `undefined` clears the
 * section.
 */
export function setOperator(config: Config, settings: OperatorSettings | undefined): Config {
  const local: LocalSection = { ...localSection(config) };
  if (settings === undefined) {
    delete local.operator;
  } else {
    local.operator = settings;
  }
  return { ...config, backend: { ...config.backend, local } };
}
