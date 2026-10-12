// ---------------------------------------------------------------------------
// Shared money helpers for the model catalog console (ModelCatalogConsole
// and the editor, detail and retire views it renders). Internal — not
// exported from the module barrel.
//
// The UI works in dollars-per-million tokens; the protos store integer
// micro-USD. Registry prices carry at most 4 decimal places, so the
// round-trip through Math.round is exact.
// ---------------------------------------------------------------------------

// BigInt literals (0n) require an ES2020 target, which not every consuming
// app's tsconfig guarantees — the constructor form is target-agnostic.
export const ZERO = BigInt(0);

/** Micro-USD per million tokens → "$X.XX/M" (raw provider rate). */
export function formatRate(microsPerMillion: bigint): string {
  const dollars = Number(microsPerMillion) / 1_000_000;
  return `$${dollars.toFixed(dollars < 1 ? 4 : 2)}/M`;
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
