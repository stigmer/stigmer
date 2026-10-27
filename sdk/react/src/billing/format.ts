// Money as the billing surface prints it, held in micro-USD on the wire, in
// two registers: a plan's price as a price list writes it ("$99/month",
// "$0.40 an hour"), and an amount on an invoice or an estimate, always to
// the cent ("$99.00").

const MICROS_PER_DOLLAR = BigInt(1_000_000);

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

/**
 * A plan's price as a price list writes it: whole dollars without cents
 * ("$99", "$1,500"), anything else to the cent ("$0.40"). For a plan's
 * terms only; an amount on an invoice or an estimate keeps
 * {@link formatUsd}'s two decimals.
 */
export function formatPrice(micros: bigint | undefined): string {
  const amount = micros ?? BigInt(0);
  const dollars = Number(amount) / Number(MICROS_PER_DOLLAR);
  return `$${amount % MICROS_PER_DOLLAR === BigInt(0) ? WHOLE_DOLLARS.format(dollars) : CENTS.format(dollars)}`;
}
