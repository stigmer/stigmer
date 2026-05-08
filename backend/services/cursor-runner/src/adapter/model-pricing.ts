/**
 * Cursor model pricing lookup, validation, and cost computation.
 *
 * Pricing data is fetched from the public model registry API and cached
 * locally with a 1-hour TTL. The pricing map is initialized on first
 * access via {@link ensureLoaded}.
 */

import { getPricingTable, DEFAULT_PRICING } from "./model-pricing-data.js";
import type { CursorModelPricing } from "./model-pricing-data.js";

export type { CursorModelPricing };

let pricingByModel: Map<string, CursorModelPricing> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ensure the pricing map has been populated from the API cache.
 *
 * Call this once at service startup or before the first pricing lookup.
 * Subsequent calls are no-ops while the cache is fresh.
 */
export async function ensureLoaded(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = getPricingTable().then((table) => {
    pricingByModel = new Map(table.map((entry) => [entry.model, entry]));
  });

  return initPromise;
}

function getMap(): Map<string, CursorModelPricing> {
  if (!pricingByModel) {
    console.warn("Model pricing accessed before ensureLoaded() — returning empty map");
    return new Map();
  }
  return pricingByModel;
}

/**
 * Validate a requested model ID against the pricing registry.
 * Returns the model ID if it has a pricing entry, otherwise falls back
 * to "default".
 */
export function resolveModelId(requestedModel: string): string {
  if (!requestedModel || requestedModel === "default") return "default";
  if (getMap().has(requestedModel)) return requestedModel;
  console.warn(
    `Model "${requestedModel}" not in pricing registry (${getMap().size} models), falling back to "default"`,
  );
  return "default";
}

/**
 * Look up pricing for a Cursor model. Falls back to Auto-pool rates for
 * unknown models (conservative default that avoids undercharging).
 */
export function getCursorModelPricing(model: string): CursorModelPricing {
  return getMap().get(model) ?? { ...DEFAULT_PRICING, model };
}

/**
 * Compute USD cost for a single turn using disjoint token buckets.
 *
 * inputTokens is the non-cached regular portion. The four buckets are
 * multiplied by their respective per-million rates.
 */
export function computeTurnCost(
  pricing: CursorModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  return (
    inputTokens * pricing.inputPricePerMillion
    + outputTokens * pricing.outputPricePerMillion
    + cacheWriteTokens * pricing.cacheWritePricePerMillion
    + cacheReadTokens * pricing.cacheReadPricePerMillion
  ) / 1_000_000;
}
