"use client";

import { cn } from "@stigmer/theme";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import {
  CREDIT_PACKS,
  formatPackPrice,
  formatCreditCount,
  type CreditPackInfo,
} from "./credit-packs.js";

/** Props for {@link CreditPackGrid}. */
export interface CreditPackGridProps {
  /** Account status — purchases disabled when suspended or closed. */
  readonly accountStatus: BillingAccountStatus;
  /** ID of the pack currently being purchased (shows loading state). */
  readonly purchasingPackId?: string | null;
  /** Called when the user clicks a pack's buy button. */
  readonly onPurchase: (packId: string) => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Grid of credit pack cards with purchase buttons.
 *
 * Displays the 3 self-serve credit packs (Starter, Growth, Team)
 * in a responsive grid. Each card shows the pack name, price,
 * credit count, and a buy button. Buttons are disabled when the
 * account is suspended/closed or a purchase is in progress.
 *
 * @example
 * ```tsx
 * <CreditPackGrid
 *   accountStatus={account.status}
 *   purchasingPackId={isSubmitting ? activePackId : null}
 *   onPurchase={(packId) => createSession({ orgId, packId, ... })}
 * />
 * ```
 */
export function CreditPackGrid({
  accountStatus,
  purchasingPackId,
  onPurchase,
  className,
}: CreditPackGridProps) {
  const isAccountActive =
    accountStatus === BillingAccountStatus.billing_account_active;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        Purchase Credits
      </h3>
      <div
        className={cn("grid gap-3 sm:grid-cols-3", className)}
        role="group"
        aria-label="Credit packs"
      >
        {CREDIT_PACKS.map((pack) => (
          <PackCard
            key={pack.packId}
            pack={pack}
            isPurchasing={purchasingPackId === pack.packId}
            isDisabled={!isAccountActive || purchasingPackId != null}
            onPurchase={onPurchase}
          />
        ))}
      </div>
      {!isAccountActive && (
        <p className="mt-2 text-xs text-muted-foreground">
          Credit purchases are unavailable while your billing account is{" "}
          {accountStatus === BillingAccountStatus.billing_account_suspended
            ? "suspended"
            : "closed"}
          .
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PackCard (internal)
// ---------------------------------------------------------------------------

function PackCard({
  pack,
  isPurchasing,
  isDisabled,
  onPurchase,
}: {
  pack: CreditPackInfo;
  isPurchasing: boolean;
  isDisabled: boolean;
  onPurchase: (packId: string) => void;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card px-4 py-4">
      <div className="text-sm font-semibold text-foreground">
        {pack.displayName}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {pack.description}
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-xl font-bold tabular-nums text-foreground">
          {formatPackPrice(pack.priceCents)}
        </span>
      </div>
      <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
        {formatCreditCount(pack.credits)} credits
      </div>

      <button
        type="button"
        disabled={isDisabled}
        onClick={() => onPurchase(pack.packId)}
        className={cn(
          "mt-4 w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          "bg-primary text-primary-foreground",
          "hover:bg-primary-hover",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        aria-busy={isPurchasing}
      >
        {isPurchasing ? "Redirecting\u2026" : "Buy"}
      </button>
    </div>
  );
}
