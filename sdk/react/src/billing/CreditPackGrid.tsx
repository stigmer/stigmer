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
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Purchase Credits
      </h3>
      <div
        className={cn("stg:grid stg:gap-3 stg:sm:grid-cols-3", className)}
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
        <p className="stg:mt-2 stg:text-xs stg:text-muted-foreground">
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
    <div className="stg:flex stg:flex-col stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-4">
      <div className="stg:text-sm stg:font-semibold stg:text-foreground">
        {pack.displayName}
      </div>
      <div className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
        {pack.description}
      </div>

      <div className="stg:mt-3 stg:flex stg:items-baseline stg:gap-1">
        <span className="stg:text-xl stg:font-bold stg:tabular-nums stg:text-foreground">
          {formatPackPrice(pack.priceCents)}
        </span>
      </div>
      <div className="stg:mt-0.5 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {formatCreditCount(pack.credits)} credits
      </div>

      <button
        type="button"
        disabled={isDisabled}
        onClick={() => onPurchase(pack.packId)}
        className={cn(
          "stg:mt-4 stg:w-full stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
          "stg:bg-primary stg:text-primary-foreground",
          "stg:hover:bg-primary-hover",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
        aria-busy={isPurchasing}
      >
        {isPurchasing ? "Redirecting\u2026" : "Buy"}
      </button>
    </div>
  );
}
