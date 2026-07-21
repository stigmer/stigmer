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
    <div className="space-y-4 rounded-lg border border-border bg-card px-4 py-3">
      {/* ── header: identity + actions ──────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {baseline.displayName || baseline.modelId}
            {governance && (
              <GovernanceBadge
                ledgerReconcilable={governance.ledgerReconcilable}
                hasOverrides={hasOverrides}
              />
            )}
            {baseline.featured && (
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
                Featured
              </span>
            )}
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {baseline.modelId} · {baseline.provider} · {baseline.harness}
            {baseline.shortDescription ? ` — ${baseline.shortDescription}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
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
        <h5 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Rates ($ per million tokens)
        </h5>
        <div className="rounded-md border border-border-muted" role="table" aria-label="Baseline vs effective rates">
          <div
            role="row"
            className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 border-b border-border-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground"
          >
            <span role="columnheader">Rate</span>
            <span role="columnheader" className="text-right">Baseline</span>
            <span role="columnheader" className="text-right">Effective</span>
          </div>
          {baseRates.map((rate) => {
            const overridden = rate.effective !== null && rate.effective !== rate.baseline;
            return (
              <div
                key={rate.label}
                role="row"
                className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 border-b border-border-muted px-2.5 py-1.5 text-xs last:border-b-0"
              >
                <span role="cell" className="text-muted-foreground">{rate.label}</span>
                <span
                  role="cell"
                  className={cn("text-right text-foreground", overridden && "line-through text-muted-foreground")}
                >
                  {formatRate(rate.baseline)}
                </span>
                <span role="cell" className={cn("text-right text-foreground", overridden && "font-medium")}>
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
          <h5 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Active Overrides
          </h5>
          <div className="space-y-1">
            {governance.activeOverrides.map((override) => (
              <p key={override.overrideId} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
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
          <h5 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Variants
          </h5>
          <div className="space-y-2">
            {Object.entries(baseline.pricingVariants).map(([key, variant]) => {
              const variantEntry =
                row.variantGovernance.find((entry) => entry.variant === key) ?? null;
              return (
                <div key={key} className="rounded-md border border-border-muted px-2.5 py-2">
                  <p className="text-xs font-medium text-foreground">
                    {key}
                    {variantEntry && (
                      <span className="ml-2 align-middle">
                        <GovernanceBadge
                          ledgerReconcilable={variantEntry.ledgerReconcilable}
                          hasOverrides={variantEntry.activeOverrides.length > 0}
                        />
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {blockRates(variant.pricing)
                      .filter(([, micros]) => micros > ZERO)
                      .map(([label, micros]) => `${label} ${formatRate(micros)}`)
                      .join(" · ") || "No rates set"}
                  </p>
                  {variant.wireIds.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
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
        <h5 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Catalog
        </h5>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
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
        <h5 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Revision History
        </h5>
        {row.history.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No previous revisions — this is the original entry.
          </p>
        ) : (
          <div className="space-y-1">
            {row.history.map((revision) => (
              <p key={revision.baselineId} className="text-[11px] text-muted-foreground">
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
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
