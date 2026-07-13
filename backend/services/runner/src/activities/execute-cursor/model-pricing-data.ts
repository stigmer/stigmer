/**
 * Cursor model pricing data — fetched from the model registry endpoint.
 *
 * On first access (or after the TTL expires), fetches the full model
 * registry from the runner's control plane (see registry-endpoint.ts for
 * endpoint resolution), filters to cursor-harness models, and caches the
 * result in memory. Falls back to conservative default pricing if the
 * endpoint is unreachable.
 */

import { resolveModelRegistryUrl, buildRegistryHeaders } from "../../shared/registry-endpoint.js";

/** Per-million rates for a speed/mode variant (e.g. "fast") of a base model. */
export interface CursorVariantPricing {
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
}

export interface CursorModelPricing {
  readonly model: string;
  readonly displayName: string;
  readonly costTier: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
  /** Speed-mode price overrides keyed by variant (e.g. "fast"); optional. */
  readonly speedVariants?: Readonly<Record<string, CursorVariantPricing>>;
}

interface RegistryVariantEntry {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheWritePricePerMillion: number;
  cacheReadPricePerMillion: number;
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
  pricingVariants?: Record<string, RegistryVariantEntry>;
}

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
      speedVariants: parseVariants(m.pricingVariants),
    }));
}

function parseVariants(
  variants: Record<string, RegistryVariantEntry> | undefined,
): Record<string, CursorVariantPricing> | undefined {
  if (!variants || typeof variants !== "object") return undefined;
  const out: Record<string, CursorVariantPricing> = {};
  for (const [key, v] of Object.entries(variants)) {
    if (!v || typeof v !== "object") continue;
    out[key] = {
      inputPricePerMillion: v.inputPricePerMillion,
      outputPricePerMillion: v.outputPricePerMillion,
      cacheWritePricePerMillion: v.cacheWritePricePerMillion,
      cacheReadPricePerMillion: v.cacheReadPricePerMillion,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function fetchFromApi(): Promise<readonly CursorModelPricing[]> {
  const res = await fetch(resolveModelRegistryUrl(), { headers: buildRegistryHeaders() });
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
