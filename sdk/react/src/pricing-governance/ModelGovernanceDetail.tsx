"use client";

import { cn } from "@stigmer/theme";
import { ModelPricingBaselineStatus } from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import type { PricingBlock } from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { GovernanceBadge } from "./governance-primitives.js";
import type { ModelGovernanceRow } from "./useModelGovernanceView.js";
import {
  RATE_FIELD_LABELS,
  ZERO,
  formatDeltaBp,
  formatRate,
} from "./pricing-format.js";

// ---------------------------------------------------------------------------
// ModelGovernanceDetail — the read-only record of one model: catalog
// metadata, baseline-vs-effective rate card, variants with wire ids,
// active overrides with provenance, and revision history. Editing is a
// separate, deliberate step (Edit / Retire actions in the header).
// Internal to the billing module.
// ---------------------------------------------------------------------------

interface RateRow {
  readonly label: string;
  readonly baseline: bigint;
  readonly effective: bigint | null;
}

/** The five rate fields of a pricing block, in canonical display order. */
function blockRates(pricing: PricingBlock | undefined): readonly (readonly [string, bigint])[] {
  return [
    ["Input", pricing?.inputPriceMicrosPerMillion ?? ZERO],
    ["Output", pricing?.outputPriceMicrosPerMillion ?? ZERO],
    ["Cache write", pricing?.cacheWritePriceMicrosPerMillion ?? ZERO],
    ["Cache read", pricing?.cacheReadPriceMicrosPerMillion ?? ZERO],
    ["Cursor token rate", pricing?.cursorTokenRateMicrosPerMillion ?? ZERO],
  ];
}

export function ModelGovernanceDetail({
  row,
  onEdit,
  onRetire,
  onBack,
}: {
  readonly row: ModelGovernanceRow;
  readonly onEdit: () => void;
  readonly onRetire: () => void;
  readonly onBack: () => void;
}) {
  const { baseline, governance } = row;
  const hasOverrides = (governance?.activeOverrides.length ?? 0) > 0;

  const baseRates: readonly RateRow[] = [
    {
      label: "Input",
      baseline: baseline.pricing?.inputPriceMicrosPerMillion ?? ZERO,
      effective: governance?.effectiveInputMicrosPerMillion ?? null,
    },
    {
      label: "Output",
      baseline: baseline.pricing?.outputPriceMicrosPerMillion ?? ZERO,
      effective: governance?.effectiveOutputMicrosPerMillion ?? null,
    },
    {
      label: "Cache write",
      baseline: baseline.pricing?.cacheWritePriceMicrosPerMillion ?? ZERO,
      effective: governance?.effectiveCacheWriteMicrosPerMillion ?? null,
    },
    {
      label: "Cache read",
      baseline: baseline.pricing?.cacheReadPriceMicrosPerMillion ?? ZERO,
      effective: governance?.effectiveCacheReadMicrosPerMillion ?? null,
    },
    {
      label: "Cursor token rate",
      baseline: baseline.pricing?.cursorTokenRateMicrosPerMillion ?? ZERO,
      effective: governance?.effectiveCursorTokenRateMicrosPerMillion ?? null,
    },
  ];

  return (
    <div className="stg:space-y-4 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-3">
      {/* ── header: identity + actions ──────────────────────────────────── */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <h4 className="stg:flex stg:flex-wrap stg:items-center stg:gap-2 stg:text-sm stg:font-semibold stg:text-foreground">
            {baseline.displayName || baseline.modelId}
            {governance && (
              <GovernanceBadge
                ledgerReconcilable={governance.ledgerReconcilable}
                hasOverrides={hasOverrides}
              />
            )}
            {baseline.featured && (
              <span className="stg:rounded stg:bg-accent stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary">
                Featured
              </span>
            )}
          </h4>
          <p className="stg:mt-0.5 stg:text-[11px] stg:text-muted-foreground">
            {baseline.modelId} · {baseline.provider} · {baseline.harness}
            {baseline.shortDescription ? ` — ${baseline.shortDescription}` : ""}
          </p>
        </div>
        <div className="stg:flex stg:shrink-0 stg:gap-2">
          <Button size="sm" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onRetire}>
            Retire
          </Button>
        </div>
      </div>

      {/* ── rate card: baseline vs effective ────────────────────────────── */}
      <section aria-label="Rates">
        <h5 className="stg:mb-1.5 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          Rates ($ per million tokens)
        </h5>
        <div className="stg:rounded-md stg:border stg:border-border-muted" role="table" aria-label="Baseline vs effective rates">
          <div
            role="row"
            className="stg:grid stg:grid-cols-[1.5fr_1fr_1fr] stg:gap-2 stg:border-b stg:border-border-muted stg:px-2.5 stg:py-1.5 stg:text-[11px] stg:font-medium stg:text-muted-foreground"
          >
            <span role="columnheader">Rate</span>
            <span role="columnheader" className="stg:text-right">Baseline</span>
            <span role="columnheader" className="stg:text-right">Effective</span>
          </div>
          {baseRates.map((rate) => {
            const overridden = rate.effective !== null && rate.effective !== rate.baseline;
            return (
              <div
                key={rate.label}
                role="row"
                className="stg:grid stg:grid-cols-[1.5fr_1fr_1fr] stg:gap-2 stg:border-b stg:border-border-muted stg:px-2.5 stg:py-1.5 stg:text-xs stg:last:border-b-0"
              >
                <span role="cell" className="stg:text-muted-foreground">{rate.label}</span>
                <span
                  role="cell"
                  className={cn("stg:text-right stg:text-foreground", overridden && "stg:line-through stg:text-muted-foreground")}
                >
                  {formatRate(rate.baseline)}
                </span>
                <span role="cell" className={cn("stg:text-right stg:text-foreground", overridden && "stg:font-medium")}>
                  {rate.effective !== null ? formatRate(rate.effective) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── active overrides with provenance ────────────────────────────── */}
      {hasOverrides && governance && (
        <section aria-label="Active pricing overrides">
          <h5 className="stg:mb-1.5 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
            Active Overrides
          </h5>
          <div className="stg:space-y-1">
            {governance.activeOverrides.map((override) => (
              <p key={override.overrideId} className="stg:text-[11px] stg:text-muted-foreground">
                <span className="stg:font-medium stg:text-foreground">
                  {RATE_FIELD_LABELS[override.rateField] ?? "Rate"}
                  {override.variant ? ` (${override.variant})` : ""}
                </span>
                {" → "}
                {formatRate(override.rateMicrosPerMillion)}
                {override.provenance && (
                  <>
                    {" · ledger observed "}
                    {formatRate(override.provenance.observedRateMicrosPerMillion)}
                    {" ("}
                    {formatDeltaBp(override.provenance.deltaBasisPoints)}
                    {") over "}
                    {override.provenance.windowFrom}..{override.provenance.windowTo}
                  </>
                )}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* ── variants ─────────────────────────────────────────────────────── */}
      {Object.keys(baseline.pricingVariants).length > 0 && (
        <section aria-label="Pricing variants">
          <h5 className="stg:mb-1.5 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
            Variants
          </h5>
          <div className="stg:space-y-2">
            {Object.entries(baseline.pricingVariants).map(([key, variant]) => {
              const variantEntry =
                row.variantGovernance.find((entry) => entry.variant === key) ?? null;
              return (
                <div key={key} className="stg:rounded-md stg:border stg:border-border-muted stg:px-2.5 stg:py-2">
                  <p className="stg:text-xs stg:font-medium stg:text-foreground">
                    {key}
                    {variantEntry && (
                      <span className="stg:ml-2 stg:align-middle">
                        <GovernanceBadge
                          ledgerReconcilable={variantEntry.ledgerReconcilable}
                          hasOverrides={variantEntry.activeOverrides.length > 0}
                        />
                      </span>
                    )}
                  </p>
                  <p className="stg:mt-0.5 stg:text-[11px] stg:text-muted-foreground">
                    {blockRates(variant.pricing)
                      .filter(([, micros]) => micros > ZERO)
                      .map(([label, micros]) => `${label} ${formatRate(micros)}`)
                      .join(" · ") || "No rates set"}
                  </p>
                  {variant.wireIds.length > 0 && (
                    <p className="stg:mt-0.5 stg:text-[11px] stg:text-muted-foreground">
                      Wire ids: {variant.wireIds.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── catalog metadata ─────────────────────────────────────────────── */}
      <section aria-label="Catalog metadata">
        <h5 className="stg:mb-1.5 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          Catalog
        </h5>
        <dl className="stg:grid stg:grid-cols-2 stg:gap-x-4 stg:gap-y-1 stg:text-xs stg:sm:grid-cols-3">
          <MetaItem label="Provider API id" value={baseline.apiModelId || "—"} />
          <MetaItem label="Speed tier" value={baseline.speedTier || "—"} />
          <MetaItem label="Cost tier" value={baseline.costTier || "—"} />
          <MetaItem
            label="Context window"
            value={baseline.contextWindowTokens > 0 ? baseline.contextWindowTokens.toLocaleString() : "—"}
          />
          <MetaItem
            label="Max output tokens"
            value={baseline.maxOutputTokens > 0 ? baseline.maxOutputTokens.toLocaleString() : "—"}
          />
          <MetaItem label="Token counter" value={baseline.tokenCounterMethod || "—"} />
        </dl>
      </section>

      {/* ── revision history ─────────────────────────────────────────────── */}
      <section aria-label="Revision history">
        <h5 className="stg:mb-1.5 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          Revision History
        </h5>
        {row.history.length === 0 ? (
          <p className="stg:text-[11px] stg:text-muted-foreground">
            No previous revisions — this is the original entry.
          </p>
        ) : (
          <div className="stg:space-y-1">
            {row.history.map((revision) => (
              <p key={revision.baselineId} className="stg:text-[11px] stg:text-muted-foreground">
                {revision.status === ModelPricingBaselineStatus.pricing_baseline_retired
                  ? "Retired"
                  : "Superseded"}
                {" · "}
                {formatRate(revision.pricing?.inputPriceMicrosPerMillion ?? ZERO)} in /{" "}
                {formatRate(revision.pricing?.outputPriceMicrosPerMillion ?? ZERO)} out
                {" · "}
                {revision.decidedBy}
                {revision.revisionNote ? ` — ${revision.revisionNote}` : ""}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetaItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="stg:text-[11px] stg:text-muted-foreground">{label}</dt>
      <dd className="stg:text-foreground">{value}</dd>
    </div>
  );
}
