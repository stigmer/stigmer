"use client";

import { cn } from "@stigmer/theme";
import { useBillingAccount } from "../billing/useBillingAccount";
import { useOrg } from "../organization/OrgProvider";
import { useDeploymentMode } from "../deployment-mode";

/** Props for {@link CreditRunwayIndicator}. */
export interface CreditRunwayIndicatorProps {
  /** Total billable cost in micro-USD for the report period. */
  readonly totalBillableCostMicros: bigint;
  /** Number of calendar days the report covers. */
  readonly daysInRange: number;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Displays projected credit runway: "~N days at this rate".
 *
 * Computes runway by dividing available balance by the daily spend rate
 * derived from the usage report. Color-coded by urgency:
 * green (>14d), amber (7-14d), red (<7d).
 *
 * Requires `useBillingAccount` — renders nothing in local mode or if
 * billing data is unavailable.
 */
export function CreditRunwayIndicator({
  totalBillableCostMicros,
  daysInRange,
  className,
}: CreditRunwayIndicatorProps) {
  const mode = useDeploymentMode();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";
  const { account } = useBillingAccount(mode === "cloud" ? orgId : "");

  if (!account?.balance || daysInRange <= 0) return null;

  const totalCost = Number(totalBillableCostMicros);
  if (totalCost <= 0) return null;

  const dailyRate = totalCost / daysInRange;
  const availableMicros = Number(account.balance.availableMicros);
  const runwayDays = Math.floor(availableMicros / dailyRate);

  if (runwayDays < 0) return null;

  const label =
    runwayDays === 0
      ? "Less than 1 day remaining"
      : `~${runwayDays} day${runwayDays === 1 ? "" : "s"} at this rate`;

  const urgency: "healthy" | "warning" | "critical" =
    runwayDays > 14 ? "healthy" : runwayDays >= 7 ? "warning" : "critical";

  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        urgency === "healthy" && "text-emerald-600 dark:text-emerald-400",
        urgency === "warning" && "text-amber-600 dark:text-amber-400",
        urgency === "critical" && "text-red-600 dark:text-red-400",
        className,
      )}
      aria-label={`Credit runway: ${label}`}
    >
      {label}
    </span>
  );
}
