/**
 * Model registry — UI-relevant metadata for all platform-supported LLM models.
 *
 * Reads from the unified JSON registry at backend/libs/model-registry.json,
 * which is the single source of truth for model IDs, display names, pricing,
 * and cost tiers across all harnesses and runtimes.
 *
 * Update it with: @update-model-registry
 */

import type { HarnessOption } from "./harness";
import registryData from "../../data/model-registry.json";

/**
 * Pricing bracket for a model.
 *
 * - `economy` — lowest-cost models suitable for high-volume or latency-sensitive tasks
 * - `standard` — balanced cost-to-capability, the default choice for most workloads
 * - `premium` — highest-capability models for complex reasoning or critical tasks
 */
export type CostTier = "economy" | "standard" | "premium";

/**
 * Latency characteristic of a model, shown as a badge in the selector.
 *
 * - `fastest` — minimal latency, small models (Haiku, Mini, Nano, Flash)
 * - `fast` — good balance of speed and capability (Sonnet, Codex, standard)
 * - `balanced` — moderate latency, larger context (Pro, GPT-4 Turbo)
 * - `slow` — highest capability, longer response times (Opus, GPT-5.5, o1)
 */
export type SpeedTier = "fastest" | "fast" | "balanced" | "slow";

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
  | "moonshot"
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
  /** 3-6 word pitch explaining why to pick this model. Shown in the curated view. */
  readonly shortDescription: string;
  /** Latency characteristic shown as a badge (Fastest / Fast / Balanced / Slow). */
  readonly speedTier: SpeedTier;
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
 * Per-model cost entry for programmatic access to pricing data.
 * Re-exported for consumers that need dollar-level pricing beyond the
 * coarse `CostTier` label.
 */
export interface ModelCostEntry {
  readonly modelId: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
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

/** Parsed result of a compound `harness/modelId` key. */
export interface ParsedModelKey {
  /** Harness portion of the compound key. */
  harness: HarnessOption;
  /** Model ID portion of the compound key. */
  modelId: string;
}

/**
 * Parse a compound key back into its `(harness, modelId)` parts.
 * Returns `undefined` for malformed keys.
 */
export function parseModelKey(key: string): ParsedModelKey | undefined {
  const idx = key.indexOf("/");
  if (idx < 1) return undefined;
  const harness = key.slice(0, idx);
  if (harness !== "native" && harness !== "cursor") return undefined;
  return { harness, modelId: key.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// JSON → ModelInfo mapping
// ---------------------------------------------------------------------------

interface RegistryJsonEntry {
  id?: string;
  displayName?: string;
  shortDescription?: string;
  speedTier?: string;
  provider?: string;
  harness?: string;
  costTier?: string;
  featured?: boolean;
  pricing?: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    cacheWritePricePerMillion: number;
    cacheReadPricePerMillion: number;
  };
  $comment?: string;
}

const VALID_COST_TIERS = new Set(["economy", "standard", "premium"]);
const VALID_SPEED_TIERS = new Set(["fastest", "fast", "balanced", "slow"]);
const VALID_HARNESSES = new Set(["native", "cursor", "copilot", "claude_code", "codex", "devin"]);

function isModelEntry(entry: RegistryJsonEntry): entry is Required<Pick<RegistryJsonEntry, "id" | "displayName" | "provider" | "harness" | "costTier">> & RegistryJsonEntry {
  return (
    typeof entry.id === "string" &&
    typeof entry.displayName === "string" &&
    typeof entry.provider === "string" &&
    typeof entry.harness === "string" && VALID_HARNESSES.has(entry.harness) &&
    typeof entry.costTier === "string" && VALID_COST_TIERS.has(entry.costTier)
  );
}

/**
 * Static catalog of all platform-supported LLM models, loaded from the
 * unified JSON registry.
 *
 * {@link useModelRegistry} filters out disabled providers and provides
 * lookup helpers on top of this list.
 */
export const MODEL_REGISTRY: readonly ModelInfo[] = (
  registryData.models as RegistryJsonEntry[]
)
  .filter(isModelEntry)
  .map((m) => ({
    modelId: m.id,
    provider: m.provider as Provider,
    displayName: m.displayName,
    shortDescription: m.shortDescription ?? "",
    speedTier: (VALID_SPEED_TIERS.has(m.speedTier ?? "") ? m.speedTier : "fast") as SpeedTier,
    costTier: m.costTier as CostTier,
    harness: m.harness as HarnessOption,
    featured: m.featured ?? false,
  }));

/**
 * Model ID used when no user preference is set (native harness).
 *
 * @deprecated Use {@link resolveDefaultModelId} for dynamic resolution
 * based on the active harness and featured models. This constant is kept
 * as the last-resort platform fallback.
 */
export const DEFAULT_MODEL_ID = "claude-sonnet-4.6";

/** Model ID used when the Cursor harness is selected and no user preference is set. */
export const DEFAULT_CURSOR_MODEL_ID = "default";

/**
 * Resolution source for the default model selection.
 *
 * Tells the caller how the default was determined, enabling
 * UI affordances like "Using org default" or "Your last choice."
 */
export type DefaultModelSource =
  | "user_preference"
  | "org_default"
  | "agent_default"
  | "harness_default"
  | "platform_fallback";

/** Result of the default model resolution. */
export interface DefaultModelResolution {
  readonly modelId: string;
  readonly source: DefaultModelSource;
}

/**
 * Resolve the default model for a given harness using a priority chain.
 *
 * Priority (Phase 1 — no backend):
 * 1. localStorage user preference (passed in as `userPreference`)
 * 2. First featured model for the harness from the registry
 * 3. Hardcoded platform fallback
 *
 * Future phases will add org-level and agent-level defaults between
 * user preference and harness default.
 */
export function resolveDefaultModelId(
  harness: HarnessOption,
  options?: {
    userPreference?: string;
    orgDefault?: string;
    agentDefault?: string;
  },
): DefaultModelResolution {
  if (options?.userPreference) {
    const model = MODEL_REGISTRY.find(
      (m) => m.harness === harness && m.modelId === options.userPreference,
    );
    if (model) return { modelId: model.modelId, source: "user_preference" };
  }

  if (options?.orgDefault) {
    const model = MODEL_REGISTRY.find(
      (m) => m.harness === harness && m.modelId === options.orgDefault,
    );
    if (model) return { modelId: model.modelId, source: "org_default" };
  }

  if (options?.agentDefault) {
    const model = MODEL_REGISTRY.find(
      (m) => m.harness === harness && m.modelId === options.agentDefault,
    );
    if (model) return { modelId: model.modelId, source: "agent_default" };
  }

  const featured = MODEL_REGISTRY.find(
    (m) => m.harness === harness && m.featured,
  );
  if (featured) return { modelId: featured.modelId, source: "harness_default" };

  const fallbackId = harness === "cursor" ? DEFAULT_CURSOR_MODEL_ID : DEFAULT_MODEL_ID;
  return { modelId: fallbackId, source: "platform_fallback" };
}

