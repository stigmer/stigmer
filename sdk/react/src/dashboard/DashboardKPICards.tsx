"use client";

/**
 * KPI cards for the operational dashboard: active, completed and failed
 * runs and the organization's tokens. Usage is tokens, never money. The
 * suite in `__tests__/DashboardKPICards.test.tsx` pins each card, the
 * compact token format, the loading placeholder and the empty render.
 */

import { memo } from "react";
import { cn } from "@stigmer/design-tokens";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { cardClasses } from "../internal/surface/Card.js";
import { Figure, Figures, type FigureTone } from "../internal/surface/Figure.js";
import { formatCompactCount } from "../usage/format.js";
import type { DashboardSummary } from "./types.js";

export interface DashboardKPICardsProps {
  readonly summary: DashboardSummary | null;
  readonly isLoading: boolean;
  readonly className?: string;
}

interface StatCardDef {
  readonly label: string;
  /** A hue only where the value is a status: runs completed, runs failed. */
  readonly tone?: FigureTone;
  readonly getValue: (s: DashboardSummary) => string;
}

const STAT_CARDS: readonly StatCardDef[] = [
  { label: "Active", getValue: (s) => String(s.activeCount) },
  { label: "Completed", tone: "ready", getValue: (s) => String(s.completedCount) },
  { label: "Failed", tone: "failed", getValue: (s) => String(s.failedCount) },
  { label: "Tokens", getValue: (s) => formatCompactCount(s.totalTokens) },
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
      <LoadingRegion label="Loading this week's figures" className={cn("stg:grid stg:grid-cols-2 stg:gap-3 stg:lg:grid-cols-4", className)}>
        {STAT_CARDS.map((card) => (
          // A figure's outline: its label's line over its value's.
          <span key={card.label} className={cn(cardClasses(), "stg:flex stg:flex-col stg:gap-2")} aria-hidden="true">
            <span className="stg:h-3 stg:w-2/5 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
            <span className="stg:h-6 stg:w-1/2 stg:animate-pulse stg:rounded stg:bg-muted" />
          </span>
        ))}
      </LoadingRegion>
    );
  }

  if (!summary) return null;

  return (
    <Figures aria-label="This week's runs" className={className}>
      {STAT_CARDS.map((card) => (
        <Figure key={card.label} label={card.label} value={card.getValue(summary)} tone={card.tone} />
      ))}
    </Figures>
  );
});
