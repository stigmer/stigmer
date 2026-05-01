/**
 * Cursor model pricing registry — per-token rates from Cursor's published
 * pricing at https://cursor.com/docs/models-and-pricing.
 *
 * Model IDs use the exact values returned by the Cursor API's GET /v1/models
 * endpoint (e.g., "claude-opus-4-7", NOT "claude-4.7-opus"). The pricing
 * module is a cost-estimation lookup only; model discovery and validation
 * are handled by model-discovery.ts via Cursor.models.list().
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
  readonly displayName: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
}

const PRICING_TABLE: readonly CursorModelPricing[] = [
  // ── Auto pool ───────────────────────────────────────────────────────
  { model: "default", displayName: "Auto", inputPricePerMillion: 1.25, outputPricePerMillion: 6.00, cacheWritePricePerMillion: 0.25, cacheReadPricePerMillion: 0.25 },

  // ── Cursor own models ───────────────────────────────────────────────
  { model: "composer-2", displayName: "Composer 2", inputPricePerMillion: 0.50, outputPricePerMillion: 2.50, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.20 },
  { model: "composer-1.5", displayName: "Composer 1.5", inputPricePerMillion: 3.50, outputPricePerMillion: 17.50, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.35 },

  // ── Anthropic via Cursor API pool ──────────────────────────────────
  { model: "claude-opus-4-7", displayName: "Opus 4.7", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.50 },
  { model: "claude-sonnet-4-6", displayName: "Sonnet 4.6", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },
  { model: "claude-opus-4-6", displayName: "Opus 4.6", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.50 },
  { model: "claude-opus-4-5", displayName: "Opus 4.5", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.50 },
  { model: "claude-sonnet-4-5", displayName: "Sonnet 4.5", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },
  { model: "claude-haiku-4-5", displayName: "Haiku 4.5", inputPricePerMillion: 1, outputPricePerMillion: 5, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.10 },
  { model: "claude-sonnet-4", displayName: "Sonnet 4", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },

  // ── OpenAI via Cursor API pool ─────────────────────────────────────
  { model: "gpt-5.5", displayName: "GPT-5.5", inputPricePerMillion: 5, outputPricePerMillion: 30, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.50 },
  { model: "gpt-5.4", displayName: "GPT-5.4", inputPricePerMillion: 2.50, outputPricePerMillion: 15, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.25 },
  { model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", inputPricePerMillion: 0.75, outputPricePerMillion: 4.50, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.075 },
  { model: "gpt-5.4-nano", displayName: "GPT-5.4 Nano", inputPricePerMillion: 0.20, outputPricePerMillion: 1.25, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.02 },
  { model: "gpt-5.3-codex", displayName: "Codex 5.3", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.3-codex-spark", displayName: "Codex 5.3 Spark", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.2", displayName: "GPT-5.2", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.2-codex", displayName: "Codex 5.2", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.1", displayName: "GPT-5.1", inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.125 },
  { model: "gpt-5.1-codex-max", displayName: "Codex 5.1 Max", inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.125 },
  { model: "gpt-5.1-codex-mini", displayName: "Codex 5.1 Mini", inputPricePerMillion: 0.25, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.025 },
  { model: "gpt-5-mini", displayName: "GPT-5 Mini", inputPricePerMillion: 0.25, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.025 },

  // ── Google via Cursor API pool ─────────────────────────────────────
  { model: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", inputPricePerMillion: 2, outputPricePerMillion: 12, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.20 },
  { model: "gemini-3-flash", displayName: "Gemini 3 Flash", inputPricePerMillion: 0.50, outputPricePerMillion: 3, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.05 },
  { model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputPricePerMillion: 0.30, outputPricePerMillion: 2.50, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.03 },

  // ── xAI via Cursor API pool ────────────────────────────────────────
  { model: "grok-4-20", displayName: "Grok 4.20", inputPricePerMillion: 2, outputPricePerMillion: 6, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.20 },

  // ── Moonshot via Cursor API pool ───────────────────────────────────
  { model: "kimi-k2.5", displayName: "Kimi K2.5", inputPricePerMillion: 0.60, outputPricePerMillion: 3, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.10 },
];

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
