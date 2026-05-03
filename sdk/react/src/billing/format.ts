import { LedgerEntryType } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

/**
 * Convert micro-USD (bigint) to a display string like "$12.50".
 *
 * Micro-USD uses 6 decimal places (1 USD = 1,000,000 micros).
 * The output always shows exactly 2 decimal places.
 */
export function formatCreditBalance(micros: bigint | undefined): string {
  if (micros === undefined) return "$0.00";
  const cents = Number(micros) / 10_000;
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Convert micro-USD (bigint) to a signed display string.
 *
 * Positive amounts show "+$5.00", negative show "-$0.23",
 * zero shows "$0.00" (no sign).
 */
export function formatLedgerAmount(micros: bigint): string {
  const zero = BigInt(0);
  const absMicros = micros < zero ? -micros : micros;
  const dollars = Number(absMicros) / 1_000_000;
  const formatted = `$${dollars.toFixed(2)}`;
  if (micros > zero) return `+${formatted}`;
  if (micros < zero) return `-${formatted}`;
  return formatted;
}

const ENTRY_LABELS: Record<number, string> = {
  [LedgerEntryType.purchase_credit]: "Credit Purchase",
  [LedgerEntryType.promotional_credit]: "Promotional Credit",
  [LedgerEntryType.usage_debit]: "Usage",
  [LedgerEntryType.reservation_hold]: "Reservation Hold",
  [LedgerEntryType.reservation_release]: "Reservation Release",
  [LedgerEntryType.adjustment_credit]: "Admin Credit",
  [LedgerEntryType.adjustment_debit]: "Admin Debit",
  [LedgerEntryType.refund_reversal]: "Refund",
  [LedgerEntryType.dispute_hold]: "Dispute Hold",
  [LedgerEntryType.dispute_release]: "Dispute Release",
  [LedgerEntryType.expiry_debit]: "Credit Expiry",
  [LedgerEntryType.auto_recharge_credit]: "Auto-Recharge",
};

/** Human-readable label for a ledger entry type. */
export function ledgerEntryLabel(type: LedgerEntryType): string {
  return ENTRY_LABELS[type] ?? "Unknown";
}

/**
 * Whether a ledger entry type represents a credit (positive amount).
 *
 * Used by UI components to choose semantic colors: green for credits,
 * red for debits, gray for holds/releases.
 */
export function isCredit(type: LedgerEntryType): boolean {
  return (
    type === LedgerEntryType.purchase_credit ||
    type === LedgerEntryType.promotional_credit ||
    type === LedgerEntryType.adjustment_credit ||
    type === LedgerEntryType.reservation_release ||
    type === LedgerEntryType.dispute_release ||
    type === LedgerEntryType.auto_recharge_credit
  );
}

/**
 * Whether a ledger entry type represents a hold operation.
 *
 * Holds are neither credits nor debits in the user's mental model —
 * they represent temporary balance changes (reservations, disputes).
 */
export function isHold(type: LedgerEntryType): boolean {
  return (
    type === LedgerEntryType.reservation_hold ||
    type === LedgerEntryType.dispute_hold
  );
}

/**
 * Format a protobuf Timestamp for ledger display.
 *
 * Returns a locale-appropriate date and time string
 * (e.g., "May 3, 2026, 4:30 PM").
 */
export function formatLedgerDate(seconds: bigint): string {
  const date = new Date(Number(seconds) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
