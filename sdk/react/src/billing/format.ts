// Money as the billing surface prints it: plan fees, extra-organization
// fees and invoice lines, all held in micro-USD on the wire.

/**
 * Convert micro-USD (bigint) to a display string like "$12.50".
 *
 * Micro-USD uses 6 decimal places (1 USD = 1,000,000 micros).
 * The output always shows exactly 2 decimal places.
 */
export function formatUsd(micros: bigint | undefined): string {
  if (micros === undefined) return "$0.00";
  const cents = Number(micros) / 10_000;
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}
