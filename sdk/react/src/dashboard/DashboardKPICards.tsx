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
  readonly getBreakdown: (s: DashboardSummary) => string | null;
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
    valueClass: "text-foreground",
    getValue: (s) => String(s.activeCount),
    getBreakdown: (s) => {
      const ag = s.agent?.activeCount ?? 0;
      const wf = s.workflow?.activeCount ?? 0;
      if (ag === 0 && wf === 0) return null;
      return `${ag} agent, ${wf} workflow`;
    },
  },
  {
    label: "Completed",
    valueClass: "text-success",
    getValue: (s) => String(s.completedCount),
    getBreakdown: (s) => {
      const ag = s.agent?.phaseCounts[3] ?? 0;
      const wf = s.workflow?.phaseCounts[3] ?? 0;
      if (ag === 0 && wf === 0) return null;
      return `${ag} agent, ${wf} workflow`;
    },
  },
  {
    label: "Failed",
    valueClass: "text-destructive",
    getValue: (s) => String(s.failedCount),
    getBreakdown: (s) => {
      const ag = s.agent?.phaseCounts[4] ?? 0;
      const wf = s.workflow?.phaseCounts[4] ?? 0;
      if (ag === 0 && wf === 0) return null;
      return `${ag} agent, ${wf} workflow`;
    },
  },
  {
    label: "Total Cost",
    valueClass: "text-foreground",
    getValue: (s) => formatCost(s.totalCostUsd),
    getBreakdown: () => null,
  },
];

/**
 * Unified stat cards showing combined agent + workflow execution KPIs.
 *
 * Each card shows the combined count with a breakdown tooltip showing
 * per-source values (e.g., "2 agent, 1 workflow").
 *
 * Cost comes from the billing source of truth (getOrgUsageReport),
 * not from summing per-domain costs. See AD-DASH-005.
 *
 * @since Unified Platform Dashboard
 */
export const DashboardKPICards = memo(function DashboardKPICards({
  summary,
  isLoading,
  className,
}: DashboardKPICardsProps) {
  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)} aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-lg border border-border bg-muted/50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {STAT_CARDS.map((card) => {
        const breakdown = card.getBreakdown(summary);
        return (
          <div
            key={card.label}
            className="rounded-lg border border-border bg-card px-4 py-3"
            title={breakdown ?? undefined}
          >
            <p className="text-xs font-medium text-muted-foreground">
              {card.label}
            </p>
            <p className={cn("mt-1 text-2xl font-semibold", card.valueClass)}>
              {card.getValue(summary)}
            </p>
            {breakdown && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {breakdown}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
});
