"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
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

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd > 0) return `<$0.01`;
  return "$0.00";
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
    label: "Total Cost",
    valueClass: "stg:text-foreground",
    getValue: (s) => formatCost(s.totalCostUsd),
  },
];

/**
 * Stat cards showing an organization's run KPIs: active,
 * completed and failed runs, and total cost.
 *
 * Cost comes from the billing source of truth (getOrgUsageReport),
 * not from summing per-run costs, so the card shows what billing recorded.
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
