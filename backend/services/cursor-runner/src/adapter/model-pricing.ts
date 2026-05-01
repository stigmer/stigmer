/**
 * Cursor model pricing lookup, validation, and cost computation.
 *
 * PRICING_TABLE in model-pricing-data.ts is the single source of truth for
 * both which models are available and what they cost. Model discovery is
 * a simple map lookup — no runtime API calls.
 *
 * Update the data with: @update-cursor-model-pricing
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
 * Validate a requested model ID against the pricing registry.
 * Returns the model ID if it has a pricing entry, otherwise falls back
 * to "default". This is the single source of truth for model availability.
 */
export function resolveModelId(requestedModel: string): string {
  if (!requestedModel || requestedModel === "default") return "default";
  if (pricingByModel.has(requestedModel)) return requestedModel;
  console.warn(
    `Model "${requestedModel}" not in pricing registry (${pricingByModel.size} models), falling back to "default"`,
  );
  return "default";
}

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
