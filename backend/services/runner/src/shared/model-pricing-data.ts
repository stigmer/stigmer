/**
 * Model pricing data — fetched from the model registry API and cached.
 *
 * On first access, fetches the full model registry, filters to models
 * with pricing info, and caches the result. Falls back to conservative
 * default pricing if the API is unreachable.
 */

export interface ModelPricing {
  readonly model: string;
  readonly displayName: string;
  readonly costTier: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
}

interface RegistryEntry {
  id: string;
  displayName: string;
  provider: string;
  harness: string;
  costTier?: string;
  pricing?: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    cacheWritePricePerMillion: number;
    cacheReadPricePerMillion: number;
  };
}

import { resolveModelRegistryUrl, buildRegistryHeaders } from "./registry-endpoint.js";

const CACHE_TTL_MS = 3_600_000;

export const DEFAULT_PRICING: ModelPricing = {
  model: "unknown",
  displayName: "Unknown",
  costTier: "standard",
  inputPricePerMillion: 1.25,
  outputPricePerMillion: 6.00,
  cacheWritePricePerMillion: 1.25,
  cacheReadPricePerMillion: 0.25,
};

let cache: { data: readonly ModelPricing[]; expiresAt: number } | null = null;
let inflightFetch: Promise<readonly ModelPricing[]> | null = null;

function parsePricingTable(json: unknown): ModelPricing[] {
  if (!json || typeof json !== "object") return [];
  const models = (json as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];

  return (models as RegistryEntry[])
    .filter((m) => m.pricing != null)
    .map((m) => ({
      model: m.id,
      displayName: m.displayName,
      costTier: m.costTier ?? "standard",
      inputPricePerMillion: m.pricing!.inputPricePerMillion,
      outputPricePerMillion: m.pricing!.outputPricePerMillion,
      cacheWritePricePerMillion: m.pricing!.cacheWritePricePerMillion,
      cacheReadPricePerMillion: m.pricing!.cacheReadPricePerMillion,
    }));
}

async function fetchFromApi(): Promise<readonly ModelPricing[]> {
  const res = await fetch(resolveModelRegistryUrl(), { headers: buildRegistryHeaders() });
  if (!res.ok) throw new Error(`Model registry fetch failed: ${res.status}`);
  const data: unknown = await res.json();
  const table = parsePricingTable(data);
  if (table.length === 0) {
    throw new Error("Model registry returned no models with pricing");
  }
  return table;
}

export async function getPricingTable(): Promise<readonly ModelPricing[]> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  if (inflightFetch) return inflightFetch;

  inflightFetch = fetchFromApi()
    .then((data) => {
      cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .catch((err) => {
      console.warn(
        `Failed to fetch model registry, using default pricing: ${err}`,
      );
      const fallback = [DEFAULT_PRICING];
      cache = { data: fallback, expiresAt: Date.now() + CACHE_TTL_MS };
      return fallback;
    })
    .finally(() => {
      inflightFetch = null;
    });

  return inflightFetch;
}
