import type { Timestamp } from "@bufbuild/protobuf/wkt";

// BigInt literals (0n) require an ES2020 target, which not every consuming
// app's tsconfig guarantees — the constructor form is target-agnostic (the
// pricing-governance pricing-format precedent).
const ZERO = BigInt(0);

/**
 * Micro-USD to a display dollar string (e.g. `169342n` → `"$0.17"`).
 * Spend figures are Cursor-reported cycle totals — two decimals is the
 * honest precision for a monitoring surface.
 */
export function formatSpendMicros(micros: bigint): string {
  const dollars = Number(micros) / 1_000_000;
  return `$${dollars.toFixed(2)}`;
}

/** Proto Timestamp to a compact local date-time (e.g. "Jul 22, 14:05"). */
export function formatSyncTime(ts: Timestamp | undefined): string {
  if (!ts || ts.seconds === ZERO) {
    return "never";
  }
  return new Date(Number(ts.seconds) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Cursor's pool-usage percent (0–100, live-verified) to a display string
 * (`26.97` → `"27%"`, `0` → `"0%"`).
 *
 * Zero renders as "0%", matching Cursor's own Members page. An earlier
 * revision suppressed it on the theory that Cursor only omits percent
 * fields on non-tiered teams (so a stored 0 meant "unreported") — live
 * data falsified that: Cursor also omits them for zero-usage members on
 * tiered Team plans, where its dashboard shows "0%". The "unreported"
 * signal is the absence of the member's whole spend row (the caller's
 * em-dash case), not a zero field inside one.
 */
export function formatPoolPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}
