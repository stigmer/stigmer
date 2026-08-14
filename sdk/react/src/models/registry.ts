/**
 * Model registry — UI-relevant metadata for all platform-supported LLM models.
 *
 * Fetches from the public model registry API endpoint at runtime and caches
 * the result in the {@link StigmerProvider} context. This eliminates the
 * static JSON file that previously shipped in the npm package.
 *
 * Platform consumers (React SDK, the runner) all fetch from the
 * same endpoint, each with their own local TTL cache.
 */

import type { HarnessOption } from "./harness.js";

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
 * models). The model registry uses this for grouping in the
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
 * The model entries themselves stay in the registry so backend
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
  /**
   * Pricing-variant keys the registry prices for this model (e.g.
   * `["fast"]`). A priced variant is a *selectable* service tier
   * (stigmer/stigmer#357): the fast-tier switch in the model popover's
   * options area renders only while the selected model's `serviceTiers`
   * includes it. Empty for models with no variants.
   *
   * Distinct from {@link speedTier}, which is a static latency badge,
   * not a selectable option.
   */
  readonly serviceTiers: readonly string[];
  /**
   * Tri-state vision capability from the registry's `capabilities` block
   * (stigmer/stigmer#386). The registry serializes `capabilities` only for
   * models whose capabilities were actually assessed, so:
   *
   * - `true` — images sent with a turn reach the model
   * - `false` — explicitly assessed as blind; warn at selection/send time
   * - `undefined` — never assessed; **stay silent, never treat as false**
   *
   * Mirrors the runner's `parseVisionCapability` convention
   * (backend/services/runner/src/shared/model-registry.ts) — both sides
   * parse the same document and must agree on what absence means.
   */
  readonly visionCapability?: boolean;
}

/**
 * Document-level vision byte budget advertised by the registry
 * (stigmer/stigmer#365) — the runner's inline-image delivery caps, exposed
 * so clients can warn *before* an upload the runner would degrade to
 * "not viewable inline". Field names match the runner's `VisionBudget`
 * options verbatim (backend/services/runner/src/shared/attachment-vision.ts).
 *
 * ADVERTISED == ENFORCED: the serving side (cloud
 * `ModelRegistryDocumentCodec`) and the runner pin the same literal values
 * in their test suites. Treat an absent block as unassessed — no warnings —
 * exactly like the per-model `capabilities` tri-state.
 */
export interface VisionLimits {
  /** Per-image raw byte cap for inline vision delivery. */
  readonly maxImageBytes: number;
  /** Per-turn total byte cap across all inline images. */
  readonly maxTotalBytes: number;
  /** Per-turn inline image count cap. */
  readonly maxImages: number;
}

/**
 * Parsed model-registry document: the per-model list plus document-level
 * platform metadata. `visionLimits` is `undefined` when the served document
 * predates the `limits` block (older servers) — consumers must stay silent
 * rather than assume a budget.
 */
export interface ModelRegistryDocument {
  readonly models: readonly ModelInfo[];
  readonly visionLimits?: VisionLimits;
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
  /** Variant-key → variant pricing block; only the key set matters here. */
  pricingVariants?: Record<string, unknown>;
  /** Capability flags; present only for capability-assessed models. */
  capabilities?: unknown;
  $comment?: string;
}

/**
 * Extract `capabilities.vision` preserving the tri-state: a missing or
 * malformed `capabilities` block stays `undefined` (never coerced to
 * false). Byte-for-byte the runner's convention — see
 * `parseVisionCapability` in the runner's `shared/model-registry.ts`.
 */
function parseVisionCapability(capabilities: unknown): boolean | undefined {
  if (!capabilities || typeof capabilities !== "object") return undefined;
  const vision = (capabilities as Record<string, unknown>).vision;
  return typeof vision === "boolean" ? vision : undefined;
}

/**
 * Parse the document-level `limits.vision` block. Returns `undefined` for
 * documents that predate the block or carry a malformed one — absence
 * means "unassessed", and a partial block must not masquerade as a budget
 * (warning against a garbled cap is worse than staying silent).
 */
function parseVisionLimits(data: Record<string, unknown>): VisionLimits | undefined {
  const limits = data.limits;
  if (!limits || typeof limits !== "object") return undefined;
  const vision = (limits as Record<string, unknown>).vision;
  if (!vision || typeof vision !== "object") return undefined;

  const { maxImageBytes, maxTotalBytes, maxImages } = vision as Record<string, unknown>;
  if (
    typeof maxImageBytes !== "number" || maxImageBytes <= 0 ||
    typeof maxTotalBytes !== "number" || maxTotalBytes <= 0 ||
    typeof maxImages !== "number" || maxImages <= 0
  ) {
    return undefined;
  }
  return { maxImageBytes, maxTotalBytes, maxImages };
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
 * Parse a raw registry document (from the API or a static file) into the
 * per-model list plus document-level metadata.
 *
 * Expects the shape `{ models: RegistryJsonEntry[], limits?: {...} }`.
 * Filters out comment entries and invalid rows. Unknown top-level fields
 * are ignored (the document contract is additive).
 */
export function parseRegistryDocument(data: unknown): ModelRegistryDocument {
  if (!data || typeof data !== "object") return { models: [] };
  const root = data as Record<string, unknown>;
  const models = root.models;
  if (!Array.isArray(models)) return { models: [] };

  const parsed = (models as RegistryJsonEntry[])
    .filter(isModelEntry)
    .map((m) => {
      const visionCapability = parseVisionCapability(m.capabilities);
      return {
        modelId: m.id,
        provider: m.provider as Provider,
        displayName: m.displayName,
        shortDescription: m.shortDescription ?? "",
        speedTier: (VALID_SPEED_TIERS.has(m.speedTier ?? "") ? m.speedTier : "fast") as SpeedTier,
        costTier: m.costTier as CostTier,
        harness: m.harness as HarnessOption,
        featured: m.featured ?? false,
        serviceTiers:
          m.pricingVariants && typeof m.pricingVariants === "object"
            ? Object.keys(m.pricingVariants).sort()
            : [],
        // Conditional spread keeps unassessed models free of the key
        // (tri-state absence, not an explicit undefined).
        ...(visionCapability !== undefined ? { visionCapability } : {}),
      };
    });

  const visionLimits = parseVisionLimits(root);
  return {
    models: parsed,
    ...(visionLimits !== undefined ? { visionLimits } : {}),
  };
}

/**
 * Parse raw registry JSON into `ModelInfo[]`.
 *
 * Thin compatibility wrapper over {@link parseRegistryDocument} — prefer
 * the document parser when the caller also needs document-level metadata
 * such as {@link VisionLimits}.
 */
export function parseRegistryJson(data: unknown): ModelInfo[] {
  return [...parseRegistryDocument(data).models];
}

/**
 * Fetch the model-registry document from the authenticated API endpoint.
 *
 * @param apiUrl - Base URL of the Stigmer Cloud API (e.g. `https://api.stigmer.ai`)
 * @param token - Bearer token for authentication (from `client.getAuthCredential()`)
 * @param customFetch - Optional custom `fetch` implementation. Required in
 *   Tauri where the global `fetch` is restricted by webview CSP/CORS policies.
 *   When omitted, the global `fetch` is used.
 * @returns Parsed {@link ModelRegistryDocument} — models plus document-level
 *   metadata like {@link VisionLimits}.
 */
export async function fetchModelRegistryDocument(
  apiUrl: string,
  token: string | null,
  customFetch?: typeof globalThis.fetch,
): Promise<ModelRegistryDocument> {
  const doFetch = customFetch ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await doFetch(`${apiUrl}/v1/proxy/model-registry`, { headers });
  if (!res.ok) throw new Error(`Model registry fetch failed: ${res.status}`);
  const data: unknown = await res.json();
  return parseRegistryDocument(data);
}

/**
 * Fetch the model registry from the authenticated API endpoint.
 *
 * Thin compatibility wrapper over {@link fetchModelRegistryDocument} —
 * prefer the document fetch when the caller also needs document-level
 * metadata such as {@link VisionLimits}.
 *
 * @returns Parsed `ModelInfo[]`.
 */
export async function fetchModelRegistry(
  apiUrl: string,
  token: string | null,
  customFetch?: typeof globalThis.fetch,
): Promise<ModelInfo[]> {
  const document = await fetchModelRegistryDocument(apiUrl, token, customFetch);
  return [...document.models];
}

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
 * 2. What the platform actually runs when nothing is pinned (see below)
 * 3. Hardcoded platform fallback
 *
 * Future phases will add org-level and agent-level defaults between
 * user preference and harness default.
 *
 * **The harness-default arm is a contract, not a suggestion**
 * (stigmer/stigmer#663): this resolution feeds the composer's model pill,
 * and the submission adopts what the pill displays — so the default MUST
 * be the model the platform would run for an unpinned execution, or the
 * pill promises one model while a different one serves the request.
 * Concretely:
 *
 * - `cursor` — the registry's Auto entry ({@link DEFAULT_CURSOR_MODEL_ID}):
 *   the runner coerces an empty `model_name` to `"default"` (Auto), so
 *   suggesting Auto and sending it explicitly are byte-identical to the
 *   pre-#663 empty send. Auto prices no fast variant, so the fast-tier
 *   switch correctly never renders for a fresh composer.
 * - `native` — the runner's own `getDefaultModel()` rule: featured AND
 *   standard cost, then any standard-cost model. A first-featured pick
 *   with no cost filter (the pre-#663 behavior) could suggest — and now
 *   would run — a premium model for users who never opened the picker.
 */
export function resolveDefaultModelId(
  harness: HarnessOption,
  models: readonly ModelInfo[],
  options?: {
    userPreference?: string;
    orgDefault?: string;
    agentDefault?: string;
  },
): DefaultModelResolution {
  if (options?.userPreference) {
    const model = models.find(
      (m) => m.harness === harness && m.modelId === options.userPreference,
    );
    if (model) return { modelId: model.modelId, source: "user_preference" };
  }

  if (options?.orgDefault) {
    const model = models.find(
      (m) => m.harness === harness && m.modelId === options.orgDefault,
    );
    if (model) return { modelId: model.modelId, source: "org_default" };
  }

  if (options?.agentDefault) {
    const model = models.find(
      (m) => m.harness === harness && m.modelId === options.agentDefault,
    );
    if (model) return { modelId: model.modelId, source: "agent_default" };
  }

  if (harness === "cursor") {
    const auto = models.find(
      (m) => m.harness === harness && m.modelId === DEFAULT_CURSOR_MODEL_ID,
    );
    if (auto) return { modelId: auto.modelId, source: "harness_default" };
  } else {
    // Mirrors the runner's unpinned resolution (featured+standard, then
    // any standard). Deliberately NOT extracted to share with the runner:
    // the runner reads its own registry snapshot on another process.
    const standardDefault =
      models.find(
        (m) => m.harness === harness && m.featured && m.costTier === "standard",
      )
      ?? models.find((m) => m.harness === harness && m.costTier === "standard");
    if (standardDefault) {
      return { modelId: standardDefault.modelId, source: "harness_default" };
    }
  }

  // Degenerate registries only (no Auto entry / no standard-cost model):
  // fall back to the old first-featured pick before the hardcoded id, so
  // the suggestion at least names a model that exists.
  const featured = models.find(
    (m) => m.harness === harness && m.featured,
  );
  if (featured) return { modelId: featured.modelId, source: "harness_default" };

  const fallbackId = harness === "cursor" ? DEFAULT_CURSOR_MODEL_ID : DEFAULT_MODEL_ID;
  return { modelId: fallbackId, source: "platform_fallback" };
}
