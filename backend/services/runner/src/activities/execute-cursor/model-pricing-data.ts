/**
 * Cursor model pricing data — fetched from the authenticated model registry API.
 *
 * On first access (or after the TTL expires), fetches the full model
 * registry from the Stigmer Cloud API, filters to cursor-harness models,
 * and caches the result in memory. Falls back to conservative default
 * pricing if the API is unreachable.
 *
 * Environment variables:
 * - STIGMER_CLOUD_API_URL: API base URL (defaults to https://api.stigmer.ai)
 * - STIGMER_AUTH_TOKEN: Bearer token for authentication (required)
 */

export interface CursorModelPricing {
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

const DEFAULT_API_URL = "https://api.stigmer.ai";
const CACHE_TTL_MS = 3_600_000; // 1 hour

const DEFAULT_PRICING: CursorModelPricing = {
  model: "unknown",
  displayName: "Unknown",
  costTier: "standard",
  inputPricePerMillion: 1.25,
  outputPricePerMillion: 6.00,
  cacheWritePricePerMillion: 1.25,
  cacheReadPricePerMillion: 0.25,
};

let cache: { data: readonly CursorModelPricing[]; expiresAt: number } | null = null;
let inflightFetch: Promise<readonly CursorModelPricing[]> | null = null;

function getApiUrl(): string {
  return process.env.STIGMER_CLOUD_API_URL ?? DEFAULT_API_URL;
}

function getAuthToken(): string | undefined {
  return process.env.STIGMER_TOKEN ?? process.env.STIGMER_AUTH_TOKEN;
}

function parsePricingTable(json: unknown): CursorModelPricing[] {
  if (!json || typeof json !== "object") return [];
  const models = (json as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];

  return (models as RegistryEntry[])
    .filter((m) => m.harness === "cursor" && m.pricing != null)
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

async function fetchFromApi(): Promise<readonly CursorModelPricing[]> {
  const url = `${getApiUrl()}/v1/proxy/model-registry`;
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Model registry fetch failed: ${res.status}`);
  const data: unknown = await res.json();
  const table = parsePricingTable(data);
  if (table.length === 0) {
    throw new Error("Model registry returned no cursor-harness models");
  }
  return table;
}

/**
 * Get the cursor model pricing table from the cached API response.
 *
 * Deduplicates concurrent calls — only one fetch is in-flight at a time.
 * Falls back to an array containing only {@link DEFAULT_PRICING} if the
 * API is unreachable.
 */
export async function getPricingTable(): Promise<readonly CursorModelPricing[]> {
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
        `Failed to fetch model registry from API, using default pricing: ${err}`,
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

export { DEFAULT_PRICING };
