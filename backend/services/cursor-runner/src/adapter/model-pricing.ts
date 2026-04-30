/**
 * Cursor model pricing registry — per-token rates from Cursor's published
 * pricing at https://cursor.com/docs/models-and-pricing.
 *
 * Cursor is the provider: Stigmer pays Cursor per-token, adds a platform
 * margin, and bills the customer. The rates here are Cursor's published API
 * rates, not the underlying LLM provider rates.
 *
 * All prices are USD per 1,000,000 tokens.
 *
 * Update this file when Cursor announces pricing changes. The pricing page
 * is the single authoritative source.
 */

export interface CursorModelPricing {
  readonly model: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
}

const PRICING_TABLE: readonly CursorModelPricing[] = [
  // ── Cursor own models ───────────────────────────────────────────────
  { model: "composer-2", inputPricePerMillion: 0.50, outputPricePerMillion: 2.50, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.20 },
  { model: "composer-1.5", inputPricePerMillion: 3.50, outputPricePerMillion: 17.50, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.35 },
  { model: "composer-1", inputPricePerMillion: 1.25, outputPricePerMillion: 10.00, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.125 },

  // ── Auto pool ───────────────────────────────────────────────────────
  { model: "auto", inputPricePerMillion: 1.25, outputPricePerMillion: 6.00, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 },

  // ── Anthropic via Cursor API pool ──────────────────────────────────
  { model: "claude-4.7-opus", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.50 },
  { model: "claude-4.6-sonnet", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },
  { model: "claude-4.6-opus", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.50 },
  { model: "claude-4.5-sonnet", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },
  { model: "claude-4.5-opus", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.50 },
  { model: "claude-4.5-haiku", inputPricePerMillion: 1, outputPricePerMillion: 5, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.10 },
  { model: "claude-4-sonnet", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },

  // ── OpenAI via Cursor API pool ─────────────────────────────────────
  { model: "gpt-5.5", inputPricePerMillion: 5, outputPricePerMillion: 30, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.50 },
  { model: "gpt-5.4", inputPricePerMillion: 2.50, outputPricePerMillion: 15, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.25 },
  { model: "gpt-5.3-codex", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5", inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.125 },

  // ── Google via Cursor API pool ─────────────────────────────────────
  { model: "gemini-3.1-pro", inputPricePerMillion: 2, outputPricePerMillion: 12, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.20 },
  { model: "gemini-3-flash", inputPricePerMillion: 0.50, outputPricePerMillion: 3, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.05 },
];

const pricingByModel = new Map<string, CursorModelPricing>(
  PRICING_TABLE.map((entry) => [entry.model, entry]),
);

const DEFAULT_PRICING: CursorModelPricing = {
  model: "unknown",
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
