"use client";

import { cn } from "@stigmer/theme";
import { AlertTriangle } from "lucide-react";
import { formatCreditBalance } from "./format.js";

/** Props for {@link LowBalanceBanner}. */
export interface LowBalanceBannerProps {
  /** Available balance in micro-USD. */
  readonly availableMicros: bigint;
  /** Threshold in micro-USD below which the warning is shown. */
  readonly thresholdMicros: bigint;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Conditional banner that warns when the available credit balance
 * is below the configured threshold.
 *
 * Renders nothing when the balance is healthy. Not dismissible —
 * it reflects a real account state that the user should address.
 *
 * @example
 * ```tsx
 * <LowBalanceBanner
 *   availableMicros={account.balance.availableMicros}
 *   thresholdMicros={account.lowBalanceThresholdMicros}
 * />
 * ```
 */
export function LowBalanceBanner({
  availableMicros,
  thresholdMicros,
  className,
}: LowBalanceBannerProps) {
  if (availableMicros >= thresholdMicros) return null;

  const isZeroOrNegative = availableMicros <= BigInt(0);

  return (
    <div
      role="alert"
      className={cn(
        "stg:flex stg:items-start stg:gap-2.5 stg:rounded-lg stg:border stg:px-3.5 stg:py-3 stg:text-xs",
        isZeroOrNegative
          ? "stg:border-destructive/30 stg:bg-destructive-subtle stg:text-destructive"
          : "stg:border-warning/30 stg:bg-warning/5 stg:text-warning-foreground",
        className,
      )}
    >
      <AlertTriangle className="stg:mt-0.5 stg:size-3.5 stg:shrink-0" aria-hidden="true" />
      <div>
        <p className="stg:font-medium">
          {isZeroOrNegative
            ? "Credit balance exhausted"
            : "Low credit balance"}
        </p>
        <p className="stg:mt-0.5 stg:opacity-80">
          {isZeroOrNegative
            ? "Your credit balance is zero. Purchase credits to continue running agent executions."
            : `Your balance (${formatCreditBalance(availableMicros)}) is below the warning threshold. Consider purchasing additional credits.`}
        </p>
      </div>
    </div>
  );
}
