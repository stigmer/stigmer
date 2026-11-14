/**
 * Model pricing lookup and cost computation.
 *
 * `computeTurnCost` is the runner's one pricer: the spending cap, the cost
 * advisory, a run's and an eval's reported cost all go through it. A model
 * priced by prompt length (`ModelPricing.longContext`, stigmer#3131) pays its
 * step's rates, for every token class, on a call whose prompt is longer than
 * the step's threshold; the prompt is all of the call's input, cache reads and
 * writes included, and each call is priced on its own. The step is Anthropic's
 * stated rule (the whole request pays, not only the tokens past the line).
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

type Rates = Pick<
  ModelPricing,
  | "inputPricePerMillion"
  | "outputPricePerMillion"
  | "cacheWritePricePerMillion"
  | "cacheReadPricePerMillion"
>;

/** The rates a call with this prompt length pays: the step's once over its threshold. */
function ratesFor(pricing: ModelPricing, promptTokens: number): Rates {
  const step = pricing.longContext;
  return step && promptTokens > step.thresholdTokens ? step : pricing;
}

/**
 * Compute USD cost for one model call from its disjoint token buckets.
 *
 * The buckets' sum is the call's prompt, which picks the rates. A caller whose
 * counts are not one call's (output no call carried) passes the prompt it is
 * to be priced at as `promptTokens`.
 */
export function computeTurnCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  promptTokens: number = inputTokens + cacheWriteTokens + cacheReadTokens,
): number {
  const rates = ratesFor(pricing, promptTokens);
  return (
    inputTokens * rates.inputPricePerMillion
    + outputTokens * rates.outputPricePerMillion
    + cacheWriteTokens * rates.cacheWritePricePerMillion
    + cacheReadTokens * rates.cacheReadPricePerMillion
  ) / 1_000_000;
}
