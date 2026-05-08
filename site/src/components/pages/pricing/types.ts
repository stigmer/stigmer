export interface ModelPricingEntry {
  modelId: string;
  displayName: string;
  provider: string;
  harness: string;
  costTier: string;
  inputPriceMicrosPerMillion: number;
  outputPriceMicrosPerMillion: number;
  cacheCreationPriceMicrosPerMillion: number;
  cacheReadPriceMicrosPerMillion: number;
  pricingPolicyId: string;
  markupBasisPoints: number;
}

const MICROS_PER_USD = 1_000_000;

export function microsPerMillionToUsdPerMillion(micros: number): number {
  return micros / MICROS_PER_USD;
}

export function formatUsdRate(micros: number): string {
  const usd = microsPerMillionToUsdPerMillion(micros);
  if (usd === 0) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function estimateCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputPriceMicrosPerMillion: number,
  outputPriceMicrosPerMillion: number,
): number {
  return (
    (inputTokens * inputPriceMicrosPerMillion) / 1_000_000 +
    (outputTokens * outputPriceMicrosPerMillion) / 1_000_000
  );
}

export function formatUsd(micros: number): string {
  const usd = micros / MICROS_PER_USD;
  if (usd < 0.01 && usd > 0) return "< $0.01";
  return `$${usd.toFixed(2)}`;
}
