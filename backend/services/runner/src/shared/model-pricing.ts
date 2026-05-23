/**
 * Model pricing lookup and cost computation.
 */

import { getPricingTable, DEFAULT_PRICING } from "./model-pricing-data.js";
import type { ModelPricing } from "./model-pricing-data.js";

export type { ModelPricing };

let pricingByModel: Map<string, ModelPricing> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ensure the pricing map has been populated from the API cache.
 * Call once at startup or before the first pricing lookup.
 */
export async function ensureLoaded(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = getPricingTable().then((table) => {
    pricingByModel = new Map(table.map((entry) => [entry.model, entry]));
  });

  return initPromise;
}

function getMap(): Map<string, ModelPricing> {
  if (!pricingByModel) {
    console.warn("Model pricing accessed before ensureLoaded() — returning empty map");
    return new Map();
  }
  return pricingByModel;
}

export function resolveModelId(requestedModel: string): string {
  if (!requestedModel || requestedModel === "default") return "default";
  if (getMap().has(requestedModel)) return requestedModel;
  console.warn(
    `Model "${requestedModel}" not in pricing registry (${getMap().size} models), falling back to "default"`,
  );
  return "default";
}

export function getModelPricing(model: string): ModelPricing {
  return getMap().get(model) ?? { ...DEFAULT_PRICING, model };
}

/**
 * Compute USD cost for a single turn using disjoint token buckets.
 */
export function computeTurnCost(
  pricing: ModelPricing,
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

/**
 * Compute cost in micro-USD for a workflow LLM call.
 *
 * Uses the cloud-fetched pricing registry (via `ensureLoaded`).
 * Returns 0 if the registry hasn't been loaded or the model is unknown.
 */
export function computeLlmCostMicros(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getMap().get(modelId);
  if (!pricing) return 0;

  const costUsd = computeTurnCost(pricing, inputTokens, outputTokens, 0, 0);
  return Math.round(costUsd * 1_000_000);
}
