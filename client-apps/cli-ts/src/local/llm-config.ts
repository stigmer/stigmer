// Typed view over the otherwise-opaque `backend.local` config section, scoped to
// the LLM settings `setup` writes and `status` reads.
//
// The config module (config/config.ts) carries `backend.local` through verbatim
// so the TS CLI never drops fields it does not model. This module adds a *typed
// lens* for the one sub-tree T05 owns — `local.llm` — and ports the Go CLI's
// `ResolveLLM*` precedence (env override > config file > provider default) so the
// two CLIs agree on which provider/model is effectively in force. Writes merge
// into a shallow copy of `local`, preserving every sibling key (temporal,
// execution, …).

import type { Config } from "../config/config.js";

/** LLM settings as persisted under `backend.local.llm` (snake_case = YAML keys). */
export interface LlmSettings {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
}

interface LocalSection {
  llm?: LlmSettings;
  [key: string]: unknown;
}

/** Default model per provider, matching the Go setup wizard's choices. */
const DEFAULT_MODEL: Record<string, string> = {
  ollama: "qwen2.5-coder:7b",
  anthropic: "claude-sonnet-4.5",
  openai: "gpt-4",
};

/** Default base URL per provider (only Ollama needs one). */
const DEFAULT_BASE_URL: Record<string, string> = {
  ollama: "http://localhost:11434",
};

function localSection(config: Config): LocalSection {
  const local = config.backend.local;
  return local !== null && typeof local === "object" ? (local as LocalSection) : {};
}

/** The persisted LLM settings, if any. */
export function readLlm(config: Config): LlmSettings | undefined {
  return localSection(config).llm;
}

/**
 * Detect a provider from API keys present in the environment (Anthropic first,
 * then OpenAI), matching the Go CLI's `DetectProviderFromAPIKeys`.
 */
export function detectProviderFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY) return "openai";
  return "";
}

/** Effective provider: env override > config > API-key autodetect. */
export function resolveProvider(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (env.STIGMER_LLM_PROVIDER) return env.STIGMER_LLM_PROVIDER;
  const llm = readLlm(config);
  if (llm?.provider) return llm.provider;
  return detectProviderFromEnv(env);
}

/** Effective model: env override > config > provider default. */
export function resolveModel(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (env.STIGMER_LLM_MODEL) return env.STIGMER_LLM_MODEL;
  const llm = readLlm(config);
  if (llm?.model) return llm.model;
  return DEFAULT_MODEL[resolveProvider(config, env)] ?? "";
}

/** Effective API key: provider-specific env var > config. */
export function resolveApiKey(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  const provider = resolveProvider(config, env);
  const envKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY : provider === "openai" ? env.OPENAI_API_KEY : "";
  if (envKey) return envKey;
  return readLlm(config)?.api_key ?? "";
}

/** Fill in provider-appropriate defaults for a partial selection. */
export function withProviderDefaults(settings: LlmSettings): LlmSettings {
  const provider = settings.provider ?? "";
  const out: LlmSettings = { provider };
  out.model = settings.model ?? DEFAULT_MODEL[provider];
  if (settings.api_key) out.api_key = settings.api_key;
  const baseUrl = settings.base_url ?? DEFAULT_BASE_URL[provider];
  if (baseUrl) out.base_url = baseUrl;
  return out;
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
