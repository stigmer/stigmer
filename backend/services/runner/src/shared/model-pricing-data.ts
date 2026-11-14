/**
 * Model pricing data — fetched from the model registry API and cached.
 *
 * On first access, fetches the full model registry, filters to models
 * with pricing info, and caches the result. Falls back to conservative
 * default pricing if the API is unreachable.
 *
 * A model priced by prompt length carries `pricing.longContext`, the rates a
 * call pays once its prompt is over `thresholdTokens` (the contract's
 * `LongContextPricing`, stigmer#3131). A step that is not well formed is
 * dropped with one warning naming the model, which is then priced at its base
 * rates: the same tolerance this parser has for the rest of a bad document.
 */

/** The rates a call pays once its prompt is longer than `thresholdTokens`. */
export interface LongContextRates {
  readonly thresholdTokens: number;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
}

export interface ModelPricing {
  readonly model: string;
  readonly displayName: string;
  readonly costTier: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
  /** Absent: one set of rates at every prompt length. */
  readonly longContext?: LongContextRates;
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
    longContext?: unknown;
  };
}

import {
  resolveModelRegistryUrl,
  buildRegistryHeaders,
  REGISTRY_RETRY_POLICY,
} from "./registry-endpoint.js";
import { fetchWithRetry } from "./http-retry.js";

const CACHE_TTL_MS = 3_600_000;
// Failed fetches are cached much shorter than successes (the model-registry.ts
// policy): a transient failure must not pin DEFAULT_PRICING — wrong rates for
// cost tracking — for a full hour.
const FAILURE_CACHE_TTL_MS = 60_000;

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

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** The step when every field is well formed; otherwise undefined. */
function parseLongContext(raw: unknown): LongContextRates | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const {
    thresholdTokens,
    inputPricePerMillion,
    outputPricePerMillion,
    cacheWritePricePerMillion,
    cacheReadPricePerMillion,
  } = raw as Record<string, unknown>;
  if (typeof thresholdTokens !== "number" || !Number.isInteger(thresholdTokens) || thresholdTokens <= 0) {
    return undefined;
  }
  if (
    !isRate(inputPricePerMillion)
    || !isRate(outputPricePerMillion)
    || !isRate(cacheWritePricePerMillion)
    || !isRate(cacheReadPricePerMillion)
  ) {
    return undefined;
  }
  return {
    thresholdTokens,
    inputPricePerMillion,
    outputPricePerMillion,
    cacheWritePricePerMillion,
    cacheReadPricePerMillion,
  };
}

function parsePricingTable(json: unknown): ModelPricing[] {
  if (!json || typeof json !== "object") return [];
  const models = (json as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];

  return (models as RegistryEntry[])
    .filter((m) => m.pricing != null)
    .map((m) => {
      const pricing = m.pricing!;
      const entry: ModelPricing = {
        model: m.id,
        displayName: m.displayName,
        costTier: m.costTier ?? "standard",
        inputPricePerMillion: pricing.inputPricePerMillion,
        outputPricePerMillion: pricing.outputPricePerMillion,
        cacheWritePricePerMillion: pricing.cacheWritePricePerMillion,
        cacheReadPricePerMillion: pricing.cacheReadPricePerMillion,
      };
      if (pricing.longContext == null) return entry;
      const longContext = parseLongContext(pricing.longContext);
      if (!longContext) {
        console.warn(
          `Model "${m.id}" has a malformed long-prompt price step; pricing it at its base rates at every prompt length`,
        );
        return entry;
      }
      return { ...entry, longContext };
    });
}

async function fetchFromApi(): Promise<readonly ModelPricing[]> {
  const res = await fetchWithRetry(
    resolveModelRegistryUrl(),
    { headers: buildRegistryHeaders() },
    REGISTRY_RETRY_POLICY,
  );
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
      cache = { data: fallback, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS };
      return fallback;
    })
    .finally(() => {
      inflightFetch = null;
    });

  return inflightFetch;
}

/** Exposed for testing — resets the in-memory cache. */
export function _resetPricingCache(): void {
  cache = null;
  inflightFetch = null;
}
