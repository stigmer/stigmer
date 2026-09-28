/**
 * Model registry — provider lookup, economy-tier model derivation, and
 * model capability resolution.
 *
 * Fetches the model registry from the runner's control plane (see
 * registry-endpoint.ts for endpoint resolution — same endpoint as
 * model-pricing-data.ts) and uses `costTier` + `harness` fields to
 * dynamically resolve economy-tier models for extraction/summarization,
 * plus `capabilities` catalog metadata for per-model capability lookups
 * (getModelVisionCapability) and the request facts a native row states
 * (getNativeRequestProfile).
 */

import {
  resolveModelRegistryUrl,
  buildRegistryHeaders,
  REGISTRY_RETRY_POLICY,
} from "./registry-endpoint.js";
import { fetchWithRetry } from "./http-retry.js";

const CACHE_TTL_MS = 3_600_000;
// Failed fetches are cached much shorter than successes: a transient failure
// must not poison id -> apiModelId resolution (and thereby fail every llm_call
// with LLM_MODEL_NOT_FOUND) for a full hour.
const FAILURE_CACHE_TTL_MS = 60_000;

interface RegistryModel {
  id: string;
  apiModelId?: string;
  provider: string;
  costTier: string;
  harness: string;
  featured: boolean;
  /**
   * Tri-state vision capability from the registry's `capabilities` block.
   * The registry serializes `capabilities` only for models whose capabilities
   * have actually been assessed, so `undefined` means "never assessed" —
   * deliberately distinct from an explicit `false` ("assessed as blind").
   * Consumers gate only on the explicit `false` (see attachment-vision.ts).
   */
  visionCapability?: boolean;
  /**
   * The model's output ceiling in tokens, as the row states it. `undefined`
   * when the row carries none or a value that is not a positive integer;
   * the caller then keeps its own default.
   */
  maxOutputTokens?: number;
  /** The thinking form the row declares; see {@link NativeThinkingProfile}. */
  thinking: NativeThinkingProfile;
}

/**
 * How a model reasons, as its registry row declares it (the proto's
 * `ModelCapabilities`):
 *
 * - `shape` is `"adaptive"` when the row declares `adaptiveThinking` (depth
 *   adapts; Anthropic `{type: "adaptive"}`), `"budget"` when it declares only
 *   `thinking` (a fixed token budget; `{type: "enabled", budget_tokens}`),
 *   and `"none"` otherwise. Adaptive wins where a row declares both: it is
 *   the current form, and the budget form is deprecated on models that take
 *   both.
 * - `required` is the row's `thinkingRequired`, tri-state: `true` for a
 *   model that always thinks and refuses to be told not to, `false` for one
 *   that accepts an explicit `{type: "disabled"}`, `undefined` for a row that
 *   was never assessed. The absence matters: a runner that read it as
 *   `false` would send `disabled` to a model that refuses it.
 */
export interface NativeThinkingProfile {
  readonly shape: "budget" | "adaptive" | "none";
  readonly required: boolean | undefined;
}

/**
 * The request facts a native-harness model's registry row states, read by
 * the native execution turn when it builds its model client. One home for
 * what the provider needs to be told about a model (the runner never names
 * models in code); a field is `undefined` when the row does not state it.
 */
export interface NativeRequestProfile {
  readonly maxOutputTokens: number | undefined;
  readonly thinking: NativeThinkingProfile;
}

let cache: { models: readonly RegistryModel[]; expiresAt: number } | null = null;
let inflightFetch: Promise<readonly RegistryModel[]> | null = null;

function parseRegistry(json: unknown): RegistryModel[] {
  if (!json || typeof json !== "object") return [];
  const models = (json as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];

  return (models as Array<Record<string, unknown>>)
    .filter((m) => typeof m.id === "string" && typeof m.provider === "string")
    .map((m) => ({
      id: m.id as string,
      apiModelId: typeof m.apiModelId === "string" ? (m.apiModelId as string) : undefined,
      provider: m.provider as string,
      costTier: (m.costTier as string) ?? "standard",
      harness: (m.harness as string) ?? "native",
      featured: !!m.featured,
      visionCapability: parseVisionCapability(m.capabilities),
      maxOutputTokens: parsePositiveInteger(m.maxOutputTokens),
      thinking: parseThinkingProfile(m.capabilities),
    }));
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The row's thinking form. A missing or malformed `capabilities` block
 * declares no shape and leaves `required` unknown, the same tri-state
 * posture as {@link parseVisionCapability}.
 */
function parseThinkingProfile(capabilities: unknown): NativeThinkingProfile {
  if (!capabilities || typeof capabilities !== "object") return { shape: "none", required: undefined };
  const flags = capabilities as Record<string, unknown>;
  const shape = flags.adaptiveThinking === true ? "adaptive" : flags.thinking === true ? "budget" : "none";
  const required = typeof flags.thinkingRequired === "boolean" ? flags.thinkingRequired : undefined;
  return { shape, required };
}

/**
 * Extract `capabilities.vision` preserving the tri-state: a missing or
 * malformed `capabilities` block stays `undefined` (never coerced to false).
 */
function parseVisionCapability(capabilities: unknown): boolean | undefined {
  if (!capabilities || typeof capabilities !== "object") return undefined;
  const vision = (capabilities as Record<string, unknown>).vision;
  return typeof vision === "boolean" ? vision : undefined;
}

async function fetchRegistry(): Promise<readonly RegistryModel[]> {
  const url = resolveModelRegistryUrl();
  const res = await fetchWithRetry(url, { headers: buildRegistryHeaders() }, REGISTRY_RETRY_POLICY);
  if (!res.ok) throw new Error(`Model registry fetch failed: ${res.status}`);
  const data: unknown = await res.json();
  return parseRegistry(data);
}

async function getRegistry(): Promise<readonly RegistryModel[]> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.models;
  }

  if (inflightFetch) return inflightFetch;

  inflightFetch = fetchRegistry()
    .then((models) => {
      cache = { models, expiresAt: Date.now() + CACHE_TTL_MS };
      return models;
    })
    .catch((err) => {
      console.warn(
        `Failed to fetch model registry from ${resolveModelRegistryUrl()}: ${err}. ` +
          `Model id resolution degrades to pass-through until the next attempt ` +
          `(${FAILURE_CACHE_TTL_MS / 1000}s). Check that the control plane is ` +
          `reachable and, for cloud endpoints, that STIGMER_TOKEN is set.`,
      );
      cache = { models: [], expiresAt: Date.now() + FAILURE_CACHE_TTL_MS };
      return [] as readonly RegistryModel[];
    })
    .finally(() => {
      inflightFetch = null;
    });

  return inflightFetch;
}

/**
 * Check whether a model identifier is known to the registry.
 *
 * Used to validate SubAgent model_override values. Returns false if the
 * registry is empty (fetch failed) — callers should treat this as "unknown"
 * and reject the override to avoid running on an unintended model.
 */
export async function isModelRegistered(modelId: string): Promise<boolean> {
  const registry = await getRegistry();
  if (registry.length === 0) return false;
  return registry.some((m) => m.id === modelId);
}

/**
 * Derive the recommended economy-tier model for summarization/classification
 * tasks, given a primary model name. Thin alias over getEconomyModel — the
 * registry (costTier=economy, harness=native, same provider preferred) drives
 * the choice; no model names are hardcoded here. See getEconomyModel for the
 * resolution order.
 */
export async function getSummarizationModel(primaryModel: string): Promise<string> {
  return getEconomyModel(primaryModel);
}

/**
 * Resolve the economy-tier model for a given primary model by querying
 * the registry for costTier=economy + same provider + harness=native.
 *
 * Resolution order:
 * 1. Find the primary model's provider in the registry
 * 2. Find an economy-tier native model from that provider
 * 3. Cross-provider fallback: any economy-tier native model
 * 4. Last resort: return the primary model itself
 */
export async function getEconomyModel(primaryModel: string): Promise<string> {
  const registry = await getRegistry();
  if (registry.length === 0) {
    // Registry unavailable: keep the caller's chosen model rather than
    // switching to a hardcoded economy model on a possibly-unconfigured
    // provider. Summarization degrades gracefully to the primary model.
    console.warn(
      `Model registry empty — falling back to primary model "${primaryModel}" for economy tier`,
    );
    return primaryModel;
  }

  const primary = registry.find((m) => m.id === primaryModel);
  const targetProvider = primary?.provider ?? "anthropic";

  const sameProviderEconomy = registry.find(
    (m) => m.provider === targetProvider && m.costTier === "economy" && m.harness === "native",
  );
  if (sameProviderEconomy) return sameProviderEconomy.id;

  const anyEconomy = registry.find(
    (m) => m.costTier === "economy" && m.harness === "native",
  );
  if (anyEconomy) return anyEconomy.id;

  if (!primary) {
    console.warn(
      `Model "${primaryModel}" not found in registry and no economy fallback available`,
    );
  }
  return primaryModel;
}

/**
 * Resolve the default agent execution model from the registry.
 *
 * Used when the user hasn't selected a model (no executionConfig.modelName).
 * Returns the provider's API model identifier (e.g., "claude-sonnet-4-6"),
 * not the Stigmer registry ID (e.g., "claude-sonnet-4.6").
 *
 * Resolution order:
 * 1. Featured + standard + native (platform's curated default)
 * 2. Any standard + native model
 * 3. Hardcoded fallback (registry unavailable)
 */
const FALLBACK_DEFAULT_MODEL = "claude-sonnet-4-6";

export async function getDefaultModel(): Promise<string> {
  const registry = await getRegistry();
  if (registry.length === 0) {
    console.warn(
      `Model registry empty — using fallback default model "${FALLBACK_DEFAULT_MODEL}"`,
    );
    return FALLBACK_DEFAULT_MODEL;
  }

  const featuredStandard = registry.find(
    (m) => m.featured && m.costTier === "standard" && m.harness === "native",
  );
  if (featuredStandard) return featuredStandard.apiModelId ?? featuredStandard.id;

  const anyStandard = registry.find(
    (m) => m.costTier === "standard" && m.harness === "native",
  );
  if (anyStandard) return anyStandard.apiModelId ?? anyStandard.id;

  return FALLBACK_DEFAULT_MODEL;
}

/**
 * Resolve a Stigmer registry model ID to the provider's API model identifier.
 *
 * The registry maintains two identifiers per model:
 *   - `id`: Stigmer canonical ID (e.g., "claude-haiku-4.5")
 *   - `apiModelId`: Provider API identifier (e.g., "claude-haiku-4-5-20251001")
 *
 * This function performs the translation that the proto documentation promises:
 * "Model reference resolved via the Stigmer model registry."
 *
 * Graceful degradation:
 *   - Registry unavailable → returns the original string unchanged
 *   - Model not found in registry → returns the original string unchanged
 *   - Model found but has no apiModelId → returns the registry `id` unchanged
 */
export async function resolveToApiModelId(registryId: string): Promise<string> {
  if (!registryId) return registryId;

  const registry = await getRegistry();
  if (registry.length === 0) return registryId;

  const entry = registry.find((m) => m.id === registryId);
  if (!entry) return registryId;

  return entry.apiModelId ?? registryId;
}

/**
 * Look up a model's vision capability from the registry's `capabilities`
 * catalog metadata. Returns the tri-state the vision policy expects
 * (attachment-vision.ts): `false` only when the registry explicitly says the
 * model cannot see images; `undefined` whenever the answer is unknown —
 * capability never assessed, model not in the registry, registry
 * unreachable, or no concrete model name (the Cursor harness's ""/"default"
 * Auto pool). Callers gate on the explicit `false` only, so every unknown
 * degrades to today's behavior instead of blocking images.
 *
 * Matches by registry `id` OR `apiModelId`: getDefaultModel() hands the
 * deep-agent harness the provider API id, while executionConfig.modelName
 * carries the registry id, so both forms arrive here.
 */
export async function getModelVisionCapability(
  modelName: string,
): Promise<boolean | undefined> {
  if (!modelName || modelName === "default") return undefined;

  const registry = await getRegistry();
  const entry = registry.find(
    (m) => m.id === modelName || m.apiModelId === modelName,
  );
  return entry?.visionCapability;
}

/**
 * The native-harness row's request facts for a model, matched by registry
 * `id` or `apiModelId` (the execution config carries the former, the
 * registry default the latter) and filtered to `harness: native`: ids such
 * as `claude-sonnet-5` exist on both harnesses, and only the native row
 * describes the native request. `undefined` when the registry is
 * unreachable, the name is empty or Auto, or no native row matches — the
 * caller then sends what it sent before.
 */
export async function getNativeRequestProfile(
  modelName: string,
): Promise<NativeRequestProfile | undefined> {
  if (!modelName || modelName === "default") return undefined;

  const registry = await getRegistry();
  const entry = registry.find(
    (m) => m.harness === "native" && (m.id === modelName || m.apiModelId === modelName),
  );
  if (!entry) return undefined;
  return { maxOutputTokens: entry.maxOutputTokens, thinking: entry.thinking };
}

/** Exposed for testing — resets the in-memory cache. */
export function _resetRegistryCache(): void {
  cache = null;
  inflightFetch = null;
}
