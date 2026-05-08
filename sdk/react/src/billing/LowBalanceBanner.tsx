"use client";

import { cn } from "@stigmer/theme";
import { AlertTriangle } from "lucide-react";
import { formatCreditBalance } from "./format";

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
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-xs",
        isZeroOrNegative
          ? "border-destructive/30 bg-destructive-subtle text-destructive"
          : "border-warning/30 bg-warning/5 text-warning-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">
          {isZeroOrNegative
            ? "Credit balance exhausted"
            : "Low credit balance"}
        </p>
        <p className="mt-0.5 opacity-80">
          {isZeroOrNegative
            ? "Your credit balance is zero. Purchase credits to continue running agent executions."
            : `Your balance (${formatCreditBalance(availableMicros)}) is below the warning threshold. Consider purchasing additional credits.`}
        </p>
      </div>
    </div>
  );
}
