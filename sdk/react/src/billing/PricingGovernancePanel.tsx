"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type {
  ModelPricingGovernanceEntry,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import {
  PricingRateField,
  type ModelPricingOverride,
} from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";
import { Button } from "../button/index.js";
import { OperatorAccessNotice } from "./OperatorAccessNotice.js";
import { usePricingGovernance } from "./usePricingGovernance.js";
import { useDecidePricingOverride } from "./useDecidePricingOverride.js";

/** Props for {@link PricingGovernancePanel}. */
export interface PricingGovernancePanelProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

const RATE_FIELD_LABELS: Record<number, string> = {
  [PricingRateField.input]: "Input",
  [PricingRateField.output]: "Output",
  [PricingRateField.cache_write]: "Cache write",
  [PricingRateField.cache_read]: "Cache read",
  [PricingRateField.cursor_token_rate]: "Cursor token rate",
};

/** Micro-USD per million tokens → "$X.XX/M" (raw provider rate). */
function formatRate(microsPerMillion: bigint): string {
  const dollars = Number(microsPerMillion) / 1_000_000;
  return `$${dollars.toFixed(dollars < 1 ? 4 : 2)}/M`;
}

function formatDeltaBp(deltaBp: bigint): string {
  const pct = Number(deltaBp) / 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/**
 * Platform-operator panel for the pricing feedback loop: pending
 * override sign-offs (approve/reject) and the effective-vs-baseline
 * pricing state of every model.
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
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted-subtle" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted-subtle" />
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
      <p className={cn("text-destructive text-xs", className)} role="alert">
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
    <div className={cn("space-y-6", className)}>
      <section aria-label="Pending pricing override proposals">
        <h3 className="mb-2 text-xs font-semibold text-foreground">
          Pending Sign-Offs
        </h3>
        {decisionError && (
          <p className="mb-2 text-destructive text-xs" role="alert">
            {getUserMessage(decisionError)}
          </p>
        )}
        {governance.pendingOverrides.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No pricing overrides awaiting a decision.
          </p>
        ) : (
          <div className="space-y-2">
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
        <h3 className="mb-2 text-xs font-semibold text-foreground">
          Model Pricing
        </h3>
        <div className="rounded-lg border border-border bg-card" role="table"
             aria-label="Model pricing governance">
          <div role="row"
               className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <span role="columnheader">Model</span>
            <span role="columnheader">Harness</span>
            <span role="columnheader" className="text-right">Input</span>
            <span role="columnheader" className="text-right">Output</span>
            <span role="columnheader" className="text-right">Governance</span>
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
// PendingOverrideCard (internal)
// ---------------------------------------------------------------------------

function PendingOverrideCard({
  override,
  isSubmitting,
  onDecide,
}: {
  readonly override: ModelPricingOverride;
  readonly isSubmitting: boolean;
  readonly onDecide: (overrideId: string, approve: boolean) => void;
}) {
  const provenance = override.provenance;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">
            {override.modelId}
            {override.variant ? ` (${override.variant})` : ""}
            {" · "}
            {RATE_FIELD_LABELS[override.rateField] ?? "Rate"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {provenance ? (
              <>
                Ledger observed {formatRate(provenance.observedRateMicrosPerMillion)} vs
                effective {formatRate(provenance.effectiveRateAtDerivationMicrosPerMillion)}
                {" "}({formatDeltaBp(provenance.deltaBasisPoints)}) over{" "}
                {provenance.windowFrom}..{provenance.windowTo}
              </>
            ) : (
              <>Proposed rate {formatRate(override.rateMicrosPerMillion)}</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            disabled={isSubmitting}
            onClick={() => onDecide(override.overrideId, true)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onDecide(override.overrideId, false)}
          >
            Reject
          </Button>
        </div>
      </div>
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
         className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0">
      <span role="cell" className="truncate font-medium text-foreground"
            title={entry.modelId}>
        {entry.displayName || entry.modelId}
      </span>
      <span role="cell" className="text-muted-foreground">{entry.harness}</span>
      <RateCell
        baseline={entry.baselineInputMicrosPerMillion}
        effective={entry.effectiveInputMicrosPerMillion}
      />
      <RateCell
        baseline={entry.baselineOutputMicrosPerMillion}
        effective={entry.effectiveOutputMicrosPerMillion}
      />
      <span role="cell" className="text-right">
        {entry.ledgerReconcilable ? (
          <span className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            hasOverrides
              ? "bg-accent text-primary"
              : "bg-muted-subtle text-muted-foreground",
          )}>
            {hasOverrides ? "Ledger-corrected" : "Ledger-verified"}
          </span>
        ) : (
          <span className="rounded bg-muted-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Manually governed
          </span>
        )}
      </span>
    </div>
  );
}

/** Effective rate; when an override moved it, the baseline shows struck-through. */
function RateCell({
  baseline,
  effective,
}: {
  readonly baseline: bigint;
  readonly effective: bigint;
}) {
  const overridden = baseline !== effective;
  return (
    <span role="cell" className="text-right text-foreground">
      {overridden && (
        <span className="mr-1 text-[10px] text-muted-foreground line-through">
          {formatRate(baseline)}
        </span>
      )}
      {formatRate(effective)}
    </span>
  );
}
