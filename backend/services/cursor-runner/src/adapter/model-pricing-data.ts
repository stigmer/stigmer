/**
 * Cursor model pricing data — thin wrapper over the unified model registry.
 *
 * Reads backend/libs/model-registry.json, filters to cursor harness models,
 * and re-exports as PRICING_TABLE for use by model-pricing.ts.
 *
 * The JSON registry is the single source of truth for all model metadata.
 * Update it with: @update-model-registry
 */

import registryData from "../../../../libs/model-registry.json" with { type: "json" };

export interface CursorModelPricing {
  readonly model: string;
  readonly displayName: string;
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
  pricing?: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    cacheWritePricePerMillion: number;
    cacheReadPricePerMillion: number;
  };
}

export const PRICING_TABLE: readonly CursorModelPricing[] = (
  registryData.models as RegistryEntry[]
)
  .filter((m) => m.harness === "cursor" && m.pricing != null)
  .map((m) => ({
    model: m.id,
    displayName: m.displayName,
    inputPricePerMillion: m.pricing!.inputPricePerMillion,
    outputPricePerMillion: m.pricing!.outputPricePerMillion,
    cacheWritePricePerMillion: m.pricing!.cacheWritePricePerMillion,
    cacheReadPricePerMillion: m.pricing!.cacheReadPricePerMillion,
  }));
