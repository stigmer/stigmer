/** Metadata for a self-serve credit pack. */
export interface CreditPackInfo {
  /** Stable identifier matching the backend catalog (e.g., "starter"). */
  readonly packId: string;
  /** Display name shown in the UI. */
  readonly displayName: string;
  /** Brief description of the pack's positioning. */
  readonly description: string;
  /** Price in USD cents (e.g., 1000 = $10.00). */
  readonly priceCents: number;
  /** Number of credits granted (1 credit = $0.01 USD). */
  readonly credits: number;
}

/**
 * Static credit pack catalog matching the backend `CreditPackCatalog`.
 *
 * Packs are static product entries, not database-backed resources.
 * At launch, credits equal the dollar value (no volume bonus).
 */
export const CREDIT_PACKS: readonly CreditPackInfo[] = [
  {
    packId: "starter",
    displayName: "Starter",
    description: "For trying things out",
    priceCents: 1_000,
    credits: 1_000,
  },
  {
    packId: "growth",
    displayName: "Growth",
    description: "For growing teams",
    priceCents: 5_000,
    credits: 5_000,
  },
  {
    packId: "team",
    displayName: "Team",
    description: "For production workloads",
    priceCents: 20_000,
    credits: 20_000,
  },
];

/** Format a cent amount as a dollar string (e.g., 1000 -> "$10"). */
export function formatPackPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Format a credit count with commas (e.g., 5000 -> "5,000"). */
export function formatCreditCount(credits: number): string {
  return credits.toLocaleString("en-US");
}
