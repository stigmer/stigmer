// Typed view over the otherwise-opaque `backend.local` config section, scoped to
// the LLM settings `setup` writes and `status` reads.
//
// The config module (config/config.ts) carries `backend.local` through verbatim
// so the CLI never drops fields it does not model. This module adds a *typed
// lens* for the one sub-tree setup owns — `local.llm` — and resolves the
// effective provider/model with env-override precedence (env > config file >
// API-key autodetect). Writes merge into a shallow copy of `local`, preserving
// every sibling key (temporal, execution, …).
//
// Local agent execution is Anthropic-only: the native runner constructs
// Anthropic clients, and the platform model registry's native-harness entries
// are all Anthropic models. Two invariants follow:
//
//   1. The model registry — not this config — owns the default execution model.
//      The runner resolves it from the registry at execution time, so this
//      module never hardcodes a model version (hardcoded versions here drifted
//      from the registry repeatedly). An unset model means "platform default".
//   2. `provider` exists to route the right API key to the runner, not to
//      select an execution backend; "anthropic" is the only provider the local
//      stack can serve.

import type { Config } from "../config/config.js";

/** LLM settings as persisted under `backend.local.llm` (snake_case = YAML keys). */
export interface LlmSettings {
  provider?: string;
  model?: string;
  api_key?: string;
}

interface LocalSection {
  llm?: LlmSettings;
  [key: string]: unknown;
}

function localSection(config: Config): LocalSection {
  const local = config.backend.local;
  return local !== null && typeof local === "object" ? (local as LocalSection) : {};
}

/** The persisted LLM settings, if any. */
export function readLlm(config: Config): LlmSettings | undefined {
  return localSection(config).llm;
}

/**
 * Detect a provider from API keys present in the environment. Anthropic is the
 * only provider local execution supports, so only ANTHROPIC_API_KEY counts.
 */
export function detectProviderFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "";
}

/** Effective provider: env override > config > API-key autodetect. */
export function resolveProvider(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (env.STIGMER_LLM_PROVIDER) return env.STIGMER_LLM_PROVIDER;
  const llm = readLlm(config);
  if (llm?.provider) return llm.provider;
  return detectProviderFromEnv(env);
}

/**
 * Effective model override: env override > config. Empty string means "no
 * override" — the runner picks the default from the platform model registry.
 */
export function resolveModel(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (env.STIGMER_LLM_MODEL) return env.STIGMER_LLM_MODEL;
  return readLlm(config)?.model ?? "";
}

/** Effective API key: ANTHROPIC_API_KEY env var > config. */
export function resolveApiKey(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (resolveProvider(config, env) !== "anthropic") return "";
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  return readLlm(config)?.api_key ?? "";
}

/**
 * Return a copy of `config` with the LLM section replaced, preserving every
 * other key under `backend.local`. Passing `undefined` clears the LLM section
 * (the wizard's "skip" path).
 */
export function setLlm(config: Config, settings: LlmSettings | undefined): Config {
  const local: LocalSection = { ...localSection(config) };
  if (settings === undefined) {
    delete local.llm;
  } else {
    local.llm = settings;
  }
  return { ...config, backend: { ...config.backend, local } };
}
