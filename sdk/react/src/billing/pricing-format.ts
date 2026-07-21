import { PricingRateField } from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";

// ---------------------------------------------------------------------------
// Shared money/label helpers for the platform-operator pricing surfaces
// (PricingGovernanceConsole and the panels it grew out of). Internal —
// not exported from the billing barrel.
//
// The UI works in dollars-per-million tokens; the protos store integer
// micro-USD. Registry prices carry at most 4 decimal places, so the
// round-trip through Math.round is exact.
// ---------------------------------------------------------------------------

// BigInt literals (0n) require an ES2020 target, which not every consuming
// app's tsconfig guarantees — the constructor form is target-agnostic.
export const ZERO = BigInt(0);

/** Human labels for {@link PricingRateField} values. */
export const RATE_FIELD_LABELS: Record<number, string> = {
  [PricingRateField.input]: "Input",
  [PricingRateField.output]: "Output",
  [PricingRateField.cache_write]: "Cache write",
  [PricingRateField.cache_read]: "Cache read",
  [PricingRateField.cursor_token_rate]: "Cursor token rate",
};

/** Micro-USD per million tokens → "$X.XX/M" (raw provider rate). */
export function formatRate(microsPerMillion: bigint): string {
  const dollars = Number(microsPerMillion) / 1_000_000;
  return `$${dollars.toFixed(dollars < 1 ? 4 : 2)}/M`;
}

/** Basis points → signed percentage, e.g. 530n → "+5.30%". */
export function formatDeltaBp(deltaBp: bigint): string {
  const pct = Number(deltaBp) / 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** Micro-USD → editable dollar string, trailing zeros trimmed ("0.075"). */
export function microsToDollarString(micros: bigint): string {
  if (micros === ZERO) return "0";
  const dollars = Number(micros) / 1_000_000;
  // Trim trailing zeros without losing sub-cent precision (e.g. 0.075).
  return String(parseFloat(dollars.toFixed(6)));
}

/** Parse a dollar input; returns null for anything that is not a finite, non-negative number. */
export function dollarsToMicros(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return BigInt(Math.round(parsed * 1_000_000));
}
