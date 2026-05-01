/**
 * Cursor model pricing lookup and cost computation.
 *
 * Pricing data lives in the auto-generated model-pricing-data.ts file.
 * Regenerate it with: STIGMER_TOKEN=stg_xxx npm run update-pricing
 *
 * This module re-exports the CursorModelPricing interface (so existing
 * importers don't need to change) and provides the lookup/compute logic.
 */

import { PRICING_TABLE } from "./model-pricing-data.js";
import type { CursorModelPricing } from "./model-pricing-data.js";

export type { CursorModelPricing };

const pricingByModel = new Map<string, CursorModelPricing>(
  PRICING_TABLE.map((entry) => [entry.model, entry]),
);

const DEFAULT_PRICING: CursorModelPricing = {
  model: "unknown",
  displayName: "Unknown",
  inputPricePerMillion: 1.25,
  outputPricePerMillion: 6.00,
  cacheWritePricePerMillion: 1.25,
  cacheReadPricePerMillion: 0.25,
};

/**
 * Look up pricing for a Cursor model. Falls back to Auto-pool rates for
 * unknown models (conservative default that avoids undercharging).
 */
export function getCursorModelPricing(model: string): CursorModelPricing {
  return pricingByModel.get(model) ?? { ...DEFAULT_PRICING, model };
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
