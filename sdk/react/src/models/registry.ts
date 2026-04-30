/**
 * Model registry — UI-relevant metadata for all platform-supported LLM models.
 *
 * Ported from the Python source of truth at
 * backend/libs/python/graphton/src/graphton/core/model_registry.py.
 *
 * This is a static, hardcoded list. A future backend RPC will replace it
 * with a dynamic query; when that happens consumers will only need to
 * swap from the static constant to a fetched result — the shape stays
 * the same.
 */

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
 * backend. The {@link MODEL_REGISTRY} groups models by provider for
 * display in {@link ModelSelector}.
 */
export type Provider = "anthropic" | "openai" | "ollama" | "cursor";

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
  "openai",
  "ollama",
  "cursor",
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
  /** Human-readable name shown in the {@link ModelSelector} dropdown. */
  readonly displayName: string;
  /** Pricing bracket used for cost-tier indicators in the UI. */
  readonly costTier: CostTier;
}

/**
 * Static catalog of all platform-supported LLM models.
 *
 * Each entry carries the metadata needed for model selection UI.
 * {@link useModelRegistry} filters out disabled providers and provides
 * lookup helpers on top of this list.
 */
export const MODEL_REGISTRY: readonly ModelInfo[] = [
  // ── Anthropic — Generation 4.6 ────────────────────────────────────
  { modelId: "claude-opus-4.6", provider: "anthropic", displayName: "Claude Opus 4.6", costTier: "premium" },
  { modelId: "claude-sonnet-4.6", provider: "anthropic", displayName: "Claude Sonnet 4.6", costTier: "standard" },

  // ── Anthropic — Generation 4.5 ────────────────────────────────────
  { modelId: "claude-opus-4.5", provider: "anthropic", displayName: "Claude Opus 4.5", costTier: "premium" },
  { modelId: "claude-sonnet-4.5", provider: "anthropic", displayName: "Claude Sonnet 4.5", costTier: "standard" },

  // ── Anthropic — Generation 4 ──────────────────────────────────────
  { modelId: "claude-opus-4", provider: "anthropic", displayName: "Claude Opus 4", costTier: "premium" },
  { modelId: "claude-haiku-4.5", provider: "anthropic", displayName: "Claude Haiku 4.5", costTier: "economy" },

  // ── Anthropic — Generation 3.5 ────────────────────────────────────
  { modelId: "claude-sonnet-3.5", provider: "anthropic", displayName: "Claude Sonnet 3.5", costTier: "standard" },
  { modelId: "claude-haiku-3.5", provider: "anthropic", displayName: "Claude Haiku 3.5", costTier: "economy" },

  // ── OpenAI ────────────────────────────────────────────────────────
  { modelId: "gpt-4", provider: "openai", displayName: "GPT-4", costTier: "premium" },
  { modelId: "gpt-4-turbo", provider: "openai", displayName: "GPT-4 Turbo", costTier: "standard" },
  { modelId: "gpt-4o", provider: "openai", displayName: "GPT-4o", costTier: "standard" },
  { modelId: "gpt-4o-mini", provider: "openai", displayName: "GPT-4o Mini", costTier: "economy" },
  { modelId: "gpt-3.5-turbo", provider: "openai", displayName: "GPT-3.5 Turbo", costTier: "economy" },
  { modelId: "o1", provider: "openai", displayName: "o1", costTier: "premium" },
  { modelId: "o1-mini", provider: "openai", displayName: "o1 Mini", costTier: "standard" },

  // ── Cursor (harness-only, not shown in native model selector) ─────
  { modelId: "composer-2", provider: "cursor", displayName: "Composer 2", costTier: "economy" },
  { modelId: "composer-1.5", provider: "cursor", displayName: "Composer 1.5", costTier: "standard" },
  { modelId: "auto", provider: "cursor", displayName: "Auto", costTier: "standard" },

  // ── Ollama (local, no cost) ───────────────────────────────────────
  { modelId: "qwen2.5-coder:7b", provider: "ollama", displayName: "Qwen 2.5 Coder 7B", costTier: "economy" },
  { modelId: "qwen2.5-coder:14b", provider: "ollama", displayName: "Qwen 2.5 Coder 14B", costTier: "economy" },
  { modelId: "codellama:7b", provider: "ollama", displayName: "Code Llama 7B", costTier: "economy" },
  { modelId: "codellama:13b", provider: "ollama", displayName: "Code Llama 13B", costTier: "economy" },
  { modelId: "deepseek-coder-v2:16b", provider: "ollama", displayName: "DeepSeek Coder V2 16B", costTier: "economy" },
  { modelId: "llama3.2:3b", provider: "ollama", displayName: "Llama 3.2 3B", costTier: "economy" },
  { modelId: "mistral:7b", provider: "ollama", displayName: "Mistral 7B", costTier: "economy" },
] as const;

/** Model ID used when no user preference is set. */
export const DEFAULT_MODEL_ID = "claude-sonnet-4.5";
