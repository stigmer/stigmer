"use client";

import { cn } from "@stigmer/theme";
import type { ModelPricingOverride } from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";
import { Button } from "../button/index.js";
import { RATE_FIELD_LABELS, formatDeltaBp, formatRate } from "./pricing-format.js";

// ---------------------------------------------------------------------------
// Shared display primitives for the operator pricing surfaces. Internal —
// not exported from the billing barrel.
// ---------------------------------------------------------------------------

/**
 * One PENDING_SIGNOFF pricing override with approve/reject actions and
 * its ledger provenance (what was observed, against what, over which
 * window) so the operator decides from evidence, not a bare number.
 */
export function PendingOverrideCard({
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

/**
 * Effective rate; when an override moved it, the baseline shows
 * struck-through. Pass `role="cell"` when rendered inside an ARIA
 * table row; leave unset inside interactive list rows (a `<button>`
 * row cannot contain table cells).
 */
export function RateCell({
  baseline,
  effective,
  role,
}: {
  readonly baseline: bigint;
  readonly effective: bigint;
  readonly role?: "cell";
}) {
  const overridden = baseline !== effective;
  return (
    <span role={role} className="text-right text-foreground">
      {overridden && (
        <span className="mr-1 text-[10px] text-muted-foreground line-through">
          {formatRate(baseline)}
        </span>
      )}
      {formatRate(effective)}
    </span>
  );
}

/**
 * Governance state chip: how this entry's rates are governed —
 * ledger-verified (reconcilable, no overrides), ledger-corrected
 * (reconcilable with active overrides), or manually governed (no
 * external ledger can verify it).
 */
export function GovernanceBadge({
  ledgerReconcilable,
  hasOverrides,
}: {
  readonly ledgerReconcilable: boolean;
  readonly hasOverrides: boolean;
}) {
  if (!ledgerReconcilable) {
    return (
      <span className="rounded bg-muted-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        Manually governed
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        hasOverrides
          ? "bg-accent text-primary"
          : "bg-muted-subtle text-muted-foreground",
      )}
    >
      {hasOverrides ? "Ledger-corrected" : "Ledger-verified"}
    </span>
  );
}
