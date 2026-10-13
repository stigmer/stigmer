"use client";

/**
 * KPI cards for the operational dashboard: active, completed and failed
 * runs and the organization's tokens. Usage is tokens, never money. The
 * suite in `__tests__/DashboardKPICards.test.tsx` pins each card, the
 * compact token format, the loading placeholder and the empty render.
 */

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { formatCompactCount } from "../usage/format.js";
import type { DashboardSummary } from "./types.js";

export interface DashboardKPICardsProps {
  readonly summary: DashboardSummary | null;
  readonly isLoading: boolean;
  readonly className?: string;
}

interface StatCardDef {
  readonly label: string;
  readonly valueClass: string;
  readonly getValue: (s: DashboardSummary) => string;
}

const STAT_CARDS: readonly StatCardDef[] = [
  {
    label: "Active",
    valueClass: "stg:text-foreground",
    getValue: (s) => String(s.activeCount),
  },
  {
    label: "Completed",
    valueClass: "stg:text-success",
    getValue: (s) => String(s.completedCount),
  },
  {
    label: "Failed",
    valueClass: "stg:text-destructive",
    getValue: (s) => String(s.failedCount),
  },
  {
    label: "Tokens",
    valueClass: "stg:text-foreground",
    getValue: (s) => formatCompactCount(s.totalTokens),
  },
];

/**
 * Stat cards showing an organization's run KPIs: active,
 * completed and failed runs, and the organization's tokens.
 *
 * Tokens come from the org usage report (getOrgUsageReport), which counts
 * each run once, so the card matches the Usage page.
 */
export const DashboardKPICards = memo(function DashboardKPICards({
  summary,
  isLoading,
  className,
}: DashboardKPICardsProps) {
  if (isLoading) {
    return (
      <div className={cn("stg:space-y-3", className)} aria-busy="true">
        <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="stg:h-[72px] stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted/50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className={cn("stg:grid stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-4", className)}>
      {STAT_CARDS.map((card) => (
        <div
          key={card.label}
          className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-3"
        >
          <p className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            {card.label}
          </p>
          <p className={cn("stg:mt-1 stg:text-2xl stg:font-semibold", card.valueClass)}>
            {card.getValue(summary)}
          </p>
        </div>
      ))}
    </div>
  );
});
