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

/**
 * Strip provider date suffixes from model IDs so that e.g.
 * "claude-haiku-4-5-20251001" matches the registry entry "claude-haiku-4-5".
 * Matches date-like suffixes: -YYYYMMDD or -YYYYMMDDvN at end of string.
 */
function normalizeModelId(model: string): string {
  return model.replace(/-\d{8}(?:v\d+)?$/, "");
}

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
 * to "default". Tries the exact ID first, then a normalized version
 * with date suffixes stripped.
 */
export function resolveModelId(requestedModel: string): string {
  if (!requestedModel || requestedModel === "default") return "default";
  const map = getMap();
  if (map.has(requestedModel)) return requestedModel;

  const normalized = normalizeModelId(requestedModel);
  if (normalized !== requestedModel && map.has(normalized)) return normalized;

  console.warn(
    `Model "${requestedModel}" (normalized: "${normalized}") not in pricing registry (${map.size} models), falling back to "default"`,
  );
  return "default";
}

/**
 * Look up pricing for a Cursor model. Falls back to Auto-pool rates for
 * unknown models (conservative default that avoids undercharging).
 * Tries the exact ID first, then a normalized version with date suffixes
 * stripped.
 */
export function getCursorModelPricing(model: string): CursorModelPricing {
  const map = getMap();
  const exact = map.get(model);
  if (exact) return exact;

  const normalized = normalizeModelId(model);
  if (normalized !== model) {
    const byNormalized = map.get(normalized);
    if (byNormalized) return byNormalized;
  }

  console.warn(
    `Pricing lookup miss for "${model}" (normalized: "${normalized}"), using DEFAULT_PRICING`,
  );
  return { ...DEFAULT_PRICING, model };
}

/**
 * Compute USD cost for a single turn.
 *
 * The Cursor SDK follows Anthropic's convention: `inputTokens` is the
 * TOTAL input tokens including cached portions. `cacheReadTokens` and
 * `cacheWriteTokens` are subsets of `inputTokens`, not additive buckets.
 *
 * To avoid double-counting, we subtract cached tokens from inputTokens
 * before applying the regular input rate:
 *   regularInput = inputTokens - cacheReadTokens - cacheWriteTokens
 */
export function computeTurnCost(
  pricing: CursorModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  const regularInput = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
  return (
    regularInput * pricing.inputPricePerMillion
    + outputTokens * pricing.outputPricePerMillion
    + cacheWriteTokens * pricing.cacheWritePricePerMillion
    + cacheReadTokens * pricing.cacheReadPricePerMillion
  ) / 1_000_000;
}
