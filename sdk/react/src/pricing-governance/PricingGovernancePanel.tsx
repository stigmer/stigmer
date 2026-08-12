"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type {
  ModelPricingGovernanceEntry,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { OperatorAccessNotice } from "./OperatorAccessNotice.js";
import { GovernanceBadge, PendingOverrideCard, RateCell } from "./governance-primitives.js";
import { usePricingGovernance } from "./usePricingGovernance.js";
import { useDecidePricingOverride } from "./useDecidePricingOverride.js";

/** Props for {@link PricingGovernancePanel}. */
export interface PricingGovernancePanelProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Platform-operator panel for the pricing feedback loop: pending
 * override sign-offs (approve/reject) and the effective-vs-baseline
 * pricing state of every model.
 *
 * Prefer {@link PricingGovernanceConsole} for new surfaces — it
 * composes this panel's content with the model catalog into one tabbed
 * console. This standalone panel remains for consumers embedding just
 * the governance view.
 *
 * Requires `can_manage_model_pricing` on `platform:stigmer` — render it
 * only in operator-scoped surfaces. Rates shown are raw provider prices
 * (pre-markup), not customer prices.
 *
 * @example
 * ```tsx
 * <PricingGovernancePanel />
 * ```
 */
export function PricingGovernancePanel({ className }: PricingGovernancePanelProps) {
  const { governance, isLoading, error, refetch } = usePricingGovernance();
  const { decide, isSubmitting, error: decisionError } = useDecidePricingOverride();

  if (isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stg:h-10 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        ))}
      </div>
    );
  }

  if (error) {
    // A non-operator landing here is expected (the route is reachable by
    // URL) — show the designed access notice, not a raw RPC error.
    if (isPermissionDenied(error)) {
      return <OperatorAccessNotice className={className} />;
    }
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (!governance) return null;

  const onDecide = async (overrideId: string, approve: boolean) => {
    try {
      await decide({ overrideId, approve });
      // A decision changes both the pending queue and (on approval) the
      // effective rates — reload the whole view.
      refetch();
    } catch {
      // Surfaced via decisionError below.
    }
  };

  return (
    <div className={cn("stg:space-y-6", className)}>
      <section aria-label="Pending pricing override proposals">
        <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
          Pending Sign-Offs
        </h3>
        {decisionError && (
          <p className="stg:mb-2 stg:text-destructive stg:text-xs" role="alert">
            {getUserMessage(decisionError)}
          </p>
        )}
        {governance.pendingOverrides.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            No pricing overrides awaiting a decision.
          </p>
        ) : (
          <div className="stg:space-y-2">
            {governance.pendingOverrides.map((override) => (
              <PendingOverrideCard
                key={override.overrideId}
                override={override}
                isSubmitting={isSubmitting}
                onDecide={onDecide}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Model pricing state">
        <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
          Model Pricing
        </h3>
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card" role="table"
             aria-label="Model pricing governance">
          <div role="row"
               className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_1fr] stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-[11px] stg:font-medium stg:text-muted-foreground">
            <span role="columnheader">Model</span>
            <span role="columnheader">Harness</span>
            <span role="columnheader" className="stg:text-right">Input</span>
            <span role="columnheader" className="stg:text-right">Output</span>
            <span role="columnheader" className="stg:text-right">Governance</span>
          </div>
          {governance.entries.map((entry) => (
            <GovernanceRow
              key={`${entry.modelId}-${entry.harness}-${entry.variant}`}
              entry={entry}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GovernanceRow (internal)
// ---------------------------------------------------------------------------

function GovernanceRow({ entry }: { readonly entry: ModelPricingGovernanceEntry }) {
  const hasOverrides = entry.activeOverrides.length > 0;
  return (
    <div role="row"
         className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_1fr] stg:items-center stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-xs stg:last:border-b-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <span role="cell" className="stg:truncate stg:font-medium stg:text-foreground" />
          }
        >
          {entry.displayName || entry.modelId}
        </TooltipTrigger>
        <TooltipContent side="top" className="stg:break-all">
          {entry.modelId}
        </TooltipContent>
      </Tooltip>
      <span role="cell" className="stg:text-muted-foreground">{entry.harness}</span>
      <RateCell
        role="cell"
        baseline={entry.baselineInputMicrosPerMillion}
        effective={entry.effectiveInputMicrosPerMillion}
      />
      <RateCell
        role="cell"
        baseline={entry.baselineOutputMicrosPerMillion}
        effective={entry.effectiveOutputMicrosPerMillion}
      />
      <span role="cell" className="stg:text-right">
        <GovernanceBadge
          ledgerReconcilable={entry.ledgerReconcilable}
          hasOverrides={hasOverrides}
        />
      </span>
    </div>
  );
}
