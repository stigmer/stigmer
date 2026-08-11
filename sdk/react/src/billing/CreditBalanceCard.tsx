"use client";

import { cn } from "@stigmer/theme";
import type { CreditBalance } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { formatCreditBalance } from "./format.js";

/** Props for {@link CreditBalanceCard}. */
export interface CreditBalanceCardProps {
  /** The credit balance breakdown from the billing account. */
  readonly balance: CreditBalance;
  /** Whether the balance is below the low-balance threshold. */
  readonly isLowBalance?: boolean;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Prominent display of the organization's available credit balance.
 *
 * Shows the total available balance as the primary figure, with
 * a secondary breakdown of promotional vs. purchased credits and
 * any reserved amount. Uses semantic colors to indicate balance
 * health: green for healthy, amber for low, red for zero/negative.
 *
 * @example
 * ```tsx
 * <CreditBalanceCard balance={account.balance} isLowBalance={isLow} />
 * ```
 */
export function CreditBalanceCard({
  balance,
  isLowBalance,
  className,
}: CreditBalanceCardProps) {
  const available = balance.availableMicros;
  const zero = BigInt(0);
  const isZeroOrNegative = available <= zero;

  return (
    <div
      className={cn(
        "stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-4",
        className,
      )}
    >
      <div className="stg:text-xs stg:font-medium stg:text-muted-foreground">
        Available Credits
      </div>
      <div
        className={cn(
          "stg:mt-1 stg:text-2xl stg:font-bold stg:tabular-nums",
          isZeroOrNegative
            ? "stg:text-destructive"
            : isLowBalance
              ? "stg:text-warning-foreground"
              : "stg:text-foreground",
        )}
      >
        {formatCreditBalance(available)}
      </div>

      <div className="stg:mt-3 stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {balance.purchasedMicros > zero && (
          <span>
            Purchased: {formatCreditBalance(balance.purchasedMicros)}
          </span>
        )}
        {balance.promotionalMicros > zero && (
          <span>
            Promotional: {formatCreditBalance(balance.promotionalMicros)}
          </span>
        )}
        {balance.reservedMicros > zero && (
          <span>
            Reserved: {formatCreditBalance(balance.reservedMicros)}
          </span>
        )}
      </div>
    </div>
  );
}
