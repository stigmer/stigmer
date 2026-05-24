/**
 * Model registry — provider lookup and economy-tier model derivation.
 *
 * Fetches the model registry from the Stigmer API (same endpoint as
 * model-pricing-data.ts) and uses `costTier` + `harness` fields to
 * dynamically resolve economy-tier models for extraction/summarization.
 */

const DEFAULT_API_URL = "https://api.stigmer.ai";
const CACHE_TTL_MS = 3_600_000;

interface RegistryModel {
  id: string;
  apiModelId?: string;
  provider: string;
  costTier: string;
  harness: string;
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
    }));
}

async function fetchRegistry(): Promise<readonly RegistryModel[]> {
  const url = `${process.env.STIGMER_CLOUD_API_URL ?? DEFAULT_API_URL}/v1/proxy/model-registry`;
  const headers: Record<string, string> = {};
  const token = process.env.STIGMER_TOKEN ?? process.env.STIGMER_AUTH_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
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
      console.warn(`Failed to fetch model registry for provider lookup: ${err}`);
      cache = { models: [], expiresAt: Date.now() + CACHE_TTL_MS };
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
 * tasks, given a primary model name.
 *
 * Resolution:
 * 1. Look up the primary model's provider in the registry
 * 2. Map provider → economy model (anthropic→claude-haiku-4.5, openai→gpt-4o-mini)
 * 3. Fall back to the primary model itself if provider is unknown or unmapped
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
    console.warn(
      `Model registry empty — cannot resolve economy model for "${primaryModel}"`,
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

/** Exposed for testing — resets the in-memory cache. */
export function _resetRegistryCache(): void {
  cache = null;
  inflightFetch = null;
}
