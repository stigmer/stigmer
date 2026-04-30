/**
 * Model registry — UI-relevant metadata for all platform-supported LLM models.
 *
 * Ported from the Python source of truth at
 * backend/libs/python/graphton/src/graphton/core/model_registry.py
 * (native harness models) and extended with Cursor harness models
 * whose IDs match `cursor-runner/src/adapter/model-pricing.ts`.
 *
 * This is a static, hardcoded list. A future backend RPC will replace it
 * with a dynamic query; when that happens consumers will only need to
 * swap from the static constant to a fetched result — the shape stays
 * the same.
 */

import type { HarnessOption } from "./harness";

/**
 * Pricing bracket for a model.
 *
 * - `economy` — lowest-cost models suitable for high-volume or latency-sensitive tasks
 * - `standard` — balanced cost-to-capability, the default choice for most workloads
 * - `premium` — highest-capability models for complex reasoning or critical tasks
 */
export type CostTier = "economy" | "standard" | "premium";

/**
 * LLM provider identifier. Each provider maps to a distinct inference
 * backend (or intermediary, in the case of Cursor-served third-party
 * models). The {@link MODEL_REGISTRY} uses this for grouping in the
 * "Show All" expanded view.
 */
export type Provider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "cursor"
  | "ollama";

/**
 * Providers whose models should be hidden from the UI.
 *
 * The model entries themselves stay in MODEL_REGISTRY so backend
 * compatibility is preserved. The useModelRegistry hook filters
 * them out before anything reaches a component.
 *
 * To re-enable a provider, simply remove it from this set.
 */
export const DISABLED_PROVIDERS: ReadonlySet<Provider> = new Set([
  "ollama",
]);

/**
 * UI-relevant metadata for a single platform-supported LLM model.
 *
 * @example
 * ```tsx
 * const { getModel, defaultModel } = useModelRegistry();
 * const model = getModel(selectedId) ?? defaultModel;
 *
 * <span>{model.displayName} ({model.costTier})</span>
 * ```
 */
export interface ModelInfo {
  /** Unique model identifier sent to the backend (e.g. `"claude-sonnet-4.5"`). */
  readonly modelId: string;
  /** LLM provider that serves this model. */
  readonly provider: Provider;
  /** Human-readable name shown in the model picker. */
  readonly displayName: string;
  /** Pricing bracket used for cost-tier indicators in the UI. */
  readonly costTier: CostTier;
  /** Which execution engine serves this model. */
  readonly harness: HarnessOption;
  /**
   * When `true`, appears in the curated default list (the short view
   * before "Show All Models" is expanded or search is used).
   */
  readonly featured: boolean;
}

/**
 * Build a compound key that uniquely identifies a model across harnesses.
 *
 * The same underlying model name (e.g. `claude-4.6-sonnet`) can exist in
 * both native and cursor harnesses. The compound key disambiguates.
 */
export function modelKey(harness: HarnessOption, modelId: string): string {
  return `${harness}/${modelId}`;
}

/**
 * Parse a compound key back into its `(harness, modelId)` parts.
 * Returns `undefined` for malformed keys.
 */
export function parseModelKey(
  key: string,
): { harness: HarnessOption; modelId: string } | undefined {
  const idx = key.indexOf("/");
  if (idx < 1) return undefined;
  const harness = key.slice(0, idx);
  if (harness !== "native" && harness !== "cursor") return undefined;
  return { harness, modelId: key.slice(idx + 1) };
}

/**
 * Static catalog of all platform-supported LLM models.
 *
 * Each entry carries the metadata needed for model selection UI.
 * {@link useModelRegistry} filters out disabled providers and provides
 * lookup helpers on top of this list.
 */
export const MODEL_REGISTRY: readonly ModelInfo[] = [
  // ═══════════════════════════════════════════════════════════════════
  //  STIGMER (native harness)
  // ═══════════════════════════════════════════════════════════════════

  // ── Anthropic — Generation 4.6 ────────────────────────────────────
  { modelId: "claude-opus-4.6", provider: "anthropic", displayName: "Claude Opus 4.6", costTier: "premium", harness: "native", featured: false },
  { modelId: "claude-sonnet-4.6", provider: "anthropic", displayName: "Claude Sonnet 4.6", costTier: "standard", harness: "native", featured: true },

  // ── Anthropic — Generation 4.5 ────────────────────────────────────
  { modelId: "claude-opus-4.5", provider: "anthropic", displayName: "Claude Opus 4.5", costTier: "premium", harness: "native", featured: false },
  { modelId: "claude-sonnet-4.5", provider: "anthropic", displayName: "Claude Sonnet 4.5", costTier: "standard", harness: "native", featured: false },

  // ── Anthropic — Generation 4 ──────────────────────────────────────
  { modelId: "claude-opus-4", provider: "anthropic", displayName: "Claude Opus 4", costTier: "premium", harness: "native", featured: false },
  { modelId: "claude-haiku-4.5", provider: "anthropic", displayName: "Claude Haiku 4.5", costTier: "economy", harness: "native", featured: false },

  // ── Anthropic — Generation 3.5 ────────────────────────────────────
  { modelId: "claude-sonnet-3.5", provider: "anthropic", displayName: "Claude Sonnet 3.5", costTier: "standard", harness: "native", featured: false },
  { modelId: "claude-haiku-3.5", provider: "anthropic", displayName: "Claude Haiku 3.5", costTier: "economy", harness: "native", featured: false },

  // ── OpenAI (native, currently disabled via DISABLED_PROVIDERS) ────
  { modelId: "gpt-4", provider: "openai", displayName: "GPT-4", costTier: "premium", harness: "native", featured: false },
  { modelId: "gpt-4-turbo", provider: "openai", displayName: "GPT-4 Turbo", costTier: "standard", harness: "native", featured: false },
  { modelId: "gpt-4o", provider: "openai", displayName: "GPT-4o", costTier: "standard", harness: "native", featured: false },
  { modelId: "gpt-4o-mini", provider: "openai", displayName: "GPT-4o Mini", costTier: "economy", harness: "native", featured: false },
  { modelId: "gpt-3.5-turbo", provider: "openai", displayName: "GPT-3.5 Turbo", costTier: "economy", harness: "native", featured: false },
  { modelId: "o1", provider: "openai", displayName: "o1", costTier: "premium", harness: "native", featured: false },
  { modelId: "o1-mini", provider: "openai", displayName: "o1 Mini", costTier: "standard", harness: "native", featured: false },

  // ═══════════════════════════════════════════════════════════════════
  //  CURSOR harness
  //  Model IDs match cursor-runner/src/adapter/model-pricing.ts
  // ═══════════════════════════════════════════════════════════════════

  // ── Cursor own models ─────────────────────────────────────────────
  { modelId: "auto", provider: "cursor", displayName: "Auto", costTier: "standard", harness: "cursor", featured: true },
  { modelId: "composer-2", provider: "cursor", displayName: "Composer 2", costTier: "economy", harness: "cursor", featured: true },
  { modelId: "composer-1.5", provider: "cursor", displayName: "Composer 1.5", costTier: "standard", harness: "cursor", featured: false },

  // ── Anthropic via Cursor ──────────────────────────────────────────
  { modelId: "claude-4.7-opus", provider: "anthropic", displayName: "Opus 4.7", costTier: "premium", harness: "cursor", featured: true },
  { modelId: "claude-4.6-opus", provider: "anthropic", displayName: "Opus 4.6", costTier: "premium", harness: "cursor", featured: true },
  { modelId: "claude-4.6-sonnet", provider: "anthropic", displayName: "Sonnet 4.6", costTier: "standard", harness: "cursor", featured: true },
  { modelId: "claude-4.5-opus", provider: "anthropic", displayName: "Opus 4.5", costTier: "premium", harness: "cursor", featured: false },
  { modelId: "claude-4.5-sonnet", provider: "anthropic", displayName: "Sonnet 4.5", costTier: "standard", harness: "cursor", featured: false },
  { modelId: "claude-4.5-haiku", provider: "anthropic", displayName: "Haiku 4.5", costTier: "economy", harness: "cursor", featured: false },
  { modelId: "claude-4-sonnet", provider: "anthropic", displayName: "Sonnet 4", costTier: "standard", harness: "cursor", featured: false },

  // ── OpenAI via Cursor ─────────────────────────────────────────────
  { modelId: "gpt-5.5", provider: "openai", displayName: "GPT-5.5", costTier: "premium", harness: "cursor", featured: true },
  { modelId: "gpt-5.3-codex", provider: "openai", displayName: "Codex 5.3", costTier: "standard", harness: "cursor", featured: true },
  { modelId: "gpt-5.4", provider: "openai", displayName: "GPT-5.4", costTier: "standard", harness: "cursor", featured: false },
  { modelId: "gpt-5", provider: "openai", displayName: "GPT-5", costTier: "standard", harness: "cursor", featured: false },

  // ── Google via Cursor ─────────────────────────────────────────────
  { modelId: "gemini-3.1-pro", provider: "google", displayName: "Gemini 3.1 Pro", costTier: "standard", harness: "cursor", featured: false },
  { modelId: "gemini-3-flash", provider: "google", displayName: "Gemini 3 Flash", costTier: "economy", harness: "cursor", featured: false },

  // ═══════════════════════════════════════════════════════════════════
  //  OLLAMA (local, disabled by default)
  // ═══════════════════════════════════════════════════════════════════
  { modelId: "qwen2.5-coder:7b", provider: "ollama", displayName: "Qwen 2.5 Coder 7B", costTier: "economy", harness: "native", featured: false },
  { modelId: "qwen2.5-coder:14b", provider: "ollama", displayName: "Qwen 2.5 Coder 14B", costTier: "economy", harness: "native", featured: false },
  { modelId: "codellama:7b", provider: "ollama", displayName: "Code Llama 7B", costTier: "economy", harness: "native", featured: false },
  { modelId: "codellama:13b", provider: "ollama", displayName: "Code Llama 13B", costTier: "economy", harness: "native", featured: false },
  { modelId: "deepseek-coder-v2:16b", provider: "ollama", displayName: "DeepSeek Coder V2 16B", costTier: "economy", harness: "native", featured: false },
  { modelId: "llama3.2:3b", provider: "ollama", displayName: "Llama 3.2 3B", costTier: "economy", harness: "native", featured: false },
  { modelId: "mistral:7b", provider: "ollama", displayName: "Mistral 7B", costTier: "economy", harness: "native", featured: false },
];

/** Model ID used when no user preference is set (native harness). */
export const DEFAULT_MODEL_ID = "claude-sonnet-4.5";

/** Model ID used when the Cursor harness is selected and no user preference is set. */
export const DEFAULT_CURSOR_MODEL_ID = "auto";
