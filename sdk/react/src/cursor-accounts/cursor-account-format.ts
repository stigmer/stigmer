import type { Timestamp } from "@bufbuild/protobuf/wkt";

// BigInt literals (0n) require an ES2020 target, which not every consuming
// app's tsconfig guarantees — the constructor form is target-agnostic (the
// billing pricing-format precedent).
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
 * (`26.97` → `"27%"`). Returns null for 0 — Cursor omits the field on
 * non-tiered teams and the sync stores 0, so 0 means "unreported", never
 * "untouched pool"; rendering it would assert precision that isn't there.
 */
export function formatPoolPercent(percent: number): string | null {
  if (percent <= 0) {
    return null;
  }
  return `${Math.round(percent)}%`;
}
