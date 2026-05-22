/**
 * Model registry — provider lookup and economy-tier model derivation.
 *
 * Fetches the model registry from the Stigmer API (same endpoint as
 * model-pricing-data.ts) but retains the `provider` field for each model.
 * Used by ClassifyToolApprovals to select an economy-tier summarization
 * model based on the primary model's provider.
 *
 * Provider → economy-tier mapping mirrors Python's ModelRegistry:
 *   anthropic → claude-haiku-4.5
 *   openai    → gpt-4o-mini
 *   ollama    → same model (no cost)
 */

const DEFAULT_API_URL = "https://api.stigmer.ai";
const CACHE_TTL_MS = 3_600_000;

const ECONOMY_MODELS: ReadonlyMap<string, string> = new Map([
  ["anthropic", "claude-haiku-4.5"],
  ["openai", "gpt-4o-mini"],
]);

interface RegistryModel {
  id: string;
  provider: string;
}

let cache: { models: readonly RegistryModel[]; expiresAt: number } | null = null;
let inflightFetch: Promise<readonly RegistryModel[]> | null = null;

function parseRegistry(json: unknown): RegistryModel[] {
  if (!json || typeof json !== "object") return [];
  const models = (json as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];

  return (models as Array<Record<string, unknown>>)
    .filter((m) => typeof m.id === "string" && typeof m.provider === "string")
    .map((m) => ({ id: m.id as string, provider: m.provider as string }));
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
  const registry = await getRegistry();
  const entry = registry.find((m) => m.id === primaryModel);

  if (!entry) {
    console.warn(
      `Model "${primaryModel}" not found in registry — using it as summarization model`,
    );
    return primaryModel;
  }

  const economyModel = ECONOMY_MODELS.get(entry.provider);
  if (!economyModel) {
    return primaryModel;
  }

  return economyModel;
}

/** Exposed for testing — resets the in-memory cache. */
export function _resetRegistryCache(): void {
  cache = null;
  inflightFetch = null;
}
