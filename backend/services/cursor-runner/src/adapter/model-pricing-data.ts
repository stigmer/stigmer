/**
 * AUTO-GENERATED — do not edit by hand.
 * Generated: 2026-05-01T11:24:00.000Z
 * Sources:
 *   Pricing: https://cursor.com/docs/models-and-pricing
 *   Models:  Stigmer proxy → Cursor /v1/models
 *
 * Regenerate with: STIGMER_TOKEN=stg_xxx npm run update-pricing
 */

export interface CursorModelPricing {
  readonly model: string;
  readonly displayName: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
}

export const PRICING_TABLE: readonly CursorModelPricing[] = [
  { model: "default", displayName: "Auto", inputPricePerMillion: 1.25, outputPricePerMillion: 6, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 },
  { model: "claude-sonnet-4", displayName: "Claude 4 Sonnet", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
  { model: "claude-haiku-4-5", displayName: "Claude 4.5 Haiku", inputPricePerMillion: 1, outputPricePerMillion: 5, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.1 },
  { model: "claude-opus-4-5", displayName: "Claude 4.5 Opus", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.5 },
  { model: "claude-sonnet-4-5", displayName: "Claude 4.5 Sonnet", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
  { model: "claude-opus-4-6", displayName: "Claude 4.6 Opus", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.5 },
  { model: "claude-sonnet-4-6", displayName: "Claude 4.6 Sonnet", inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
  { model: "claude-opus-4-7", displayName: "Claude 4.7 Opus", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.5 },
  { model: "composer-1", displayName: "Composer 1", inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.125 },
  { model: "composer-1.5", displayName: "Composer 1.5", inputPricePerMillion: 3.5, outputPricePerMillion: 17.5, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.35 },
  { model: "composer-2", displayName: "Composer 2", inputPricePerMillion: 0.5, outputPricePerMillion: 2.5, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.2 },
  { model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputPricePerMillion: 0.3, outputPricePerMillion: 2.5, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.03 },
  { model: "gemini-3-flash", displayName: "Gemini 3 Flash", inputPricePerMillion: 0.5, outputPricePerMillion: 3, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.05 },
  { model: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", inputPricePerMillion: 2, outputPricePerMillion: 12, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.2 },
  { model: "gpt-5-mini", displayName: "GPT-5 Mini", inputPricePerMillion: 0.25, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.025 },
  { model: "gpt-5.1-codex-max", displayName: "GPT-5.1 Codex Max", inputPricePerMillion: 1.25, outputPricePerMillion: 10, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.125 },
  { model: "gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini", inputPricePerMillion: 0.25, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.025 },
  { model: "gpt-5.2", displayName: "GPT-5.2", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.2-codex", displayName: "GPT-5.2 Codex", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", inputPricePerMillion: 1.75, outputPricePerMillion: 14, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.175 },
  { model: "gpt-5.4", displayName: "GPT-5.4", inputPricePerMillion: 2.5, outputPricePerMillion: 15, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.25 },
  { model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", inputPricePerMillion: 0.75, outputPricePerMillion: 4.5, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.075 },
  { model: "gpt-5.4-nano", displayName: "GPT-5.4 Nano", inputPricePerMillion: 0.2, outputPricePerMillion: 1.25, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.02 },
  { model: "gpt-5.5", displayName: "GPT-5.5", inputPricePerMillion: 5, outputPricePerMillion: 30, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.5 },
  { model: "grok-4-20", displayName: "Grok 4.20", inputPricePerMillion: 2, outputPricePerMillion: 6, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.2 },
  { model: "kimi-k2.5", displayName: "Kimi K2.5", inputPricePerMillion: 0.6, outputPricePerMillion: 3, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.1 },
];
