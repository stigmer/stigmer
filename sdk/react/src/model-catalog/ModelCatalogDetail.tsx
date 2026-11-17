"use client";

// ---------------------------------------------------------------------------
// ModelCatalogDetail — the read-only record of one model, under the page's
// title (its name) as the settings pages draw a detail: its rates on the
// table part, and under them the higher rates a long prompt pays when the
// model has that step ("Above 100,000 prompt tokens"); its variants, each
// with its own rates and step; its catalog record; its earlier revisions.
// Editing and retiring are the page header's acts. Internal to the
// model-catalog module.
// ---------------------------------------------------------------------------

import { ModelPricingBaselineStatus } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import type {
  LongContextPricing,
  PricingBlock,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Section } from "../resource-detail/Section.js";
import { Table, type TableColumn } from "../internal/surface/Table.js";
import { ReadOnlyField, ReadOnlyFields } from "../internal/form/ReadOnlyField.js";
import type { ModelCatalogRow } from "./useModelCatalogView.js";
import { ZERO, formatRate, formatTokens } from "./pricing-format.js";
import { EmptyState } from "../empty-state/EmptyState.js";

/** The four rates of a block or a step, micro-USD per million tokens. */
interface FourRates {
  readonly input: bigint;
  readonly output: bigint;
  readonly cacheWrite: bigint;
  readonly cacheRead: bigint;
}

function ratesOf(rates: PricingBlock | LongContextPricing | undefined): FourRates {
  return {
    input: rates?.inputPriceMicrosPerMillion ?? ZERO,
    output: rates?.outputPriceMicrosPerMillion ?? ZERO,
    cacheWrite: rates?.cacheWritePriceMicrosPerMillion ?? ZERO,
    cacheRead: rates?.cacheReadPriceMicrosPerMillion ?? ZERO,
  };
}

const RATE_COLUMNS: readonly TableColumn<FourRates>[] = [
  { id: "input", header: "Input", align: "end", cell: (r) => formatRate(r.input) },
  { id: "output", header: "Output", align: "end", cell: (r) => formatRate(r.output) },
  { id: "cache-write", header: "Cache write", align: "end", cell: (r) => formatRate(r.cacheWrite) },
  { id: "cache-read", header: "Cache read", align: "end", cell: (r) => formatRate(r.cacheRead) },
];

/** One block's four rates, as one row of the table part. */
function RateTable({ rates, label }: { readonly rates: FourRates; readonly label: string }) {
  return <Table bare columns={RATE_COLUMNS} rows={[rates]} rowKey={() => "rates"} aria-label={label} />;
}

/**
 * The higher rates a long prompt pays, under the block's own: nothing for
 * a block without a step.
 */
function LongPromptStep({ step, label }: { readonly step: LongContextPricing | undefined; readonly label: string }) {
  if (!step || step.thresholdTokens <= 0) return null;
  const heading = `Above ${formatTokens(step.thresholdTokens)} prompt tokens`;
  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      <p className="stg:m-0 stg:px-3.5 stg:text-xs stg:font-semibold stg:text-foreground">{heading}</p>
      <RateTable rates={ratesOf(step)} label={`${label}, ${heading.toLowerCase()}`} />
    </div>
  );
}

/** Where a block's rates came from, in one quiet line. */
function provenance(pricing: PricingBlock | undefined): string | null {
  const parts: string[] = [];
  if (pricing?.source) parts.push(`Source: ${pricing.source}`);
  if (pricing?.effectiveAt) {
    const date = new Date(Number(pricing.effectiveAt.seconds) * 1000);
    parts.push(date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The read-only record of one catalog model. */
export function ModelCatalogDetail({ row }: { readonly row: ModelCatalogRow }) {
  const { baseline } = row;
  const variants = Object.entries(baseline.pricingVariants);
  const source = provenance(baseline.pricing);

  return (
    <div className="stg:flex stg:flex-col stg:gap-4">
      <Section title="Rates">
        <div className="stg:flex stg:flex-col stg:gap-3 stg:pb-3">
          <RateTable rates={ratesOf(baseline.pricing)} label="Baseline rates" />
          <LongPromptStep step={baseline.pricing?.longContext} label="Baseline rates" />
          {source && <p className="stg:m-0 stg:px-3.5 stg:text-xs stg:text-muted-foreground">{source}</p>}
        </div>
      </Section>

      {variants.length > 0 && (
        <Section title="Variants" count={variants.length}>
          <ul aria-label="Pricing variants" className="stg:m-0 stg:flex stg:list-none stg:flex-col stg:gap-4 stg:p-0 stg:py-3">
            {variants.map(([key, variant]) => (
              <li key={key} className="stg:flex stg:flex-col stg:gap-2">
                <p className="stg:m-0 stg:px-3.5 stg:text-sm stg:font-medium stg:text-foreground">
                  {key}
                  {variant.wireIds.length > 0 && (
                    <span className="stg:text-xs stg:font-normal stg:text-muted-foreground">
                      {" · wire ids "}
                      {variant.wireIds.join(", ")}
                    </span>
                  )}
                </p>
                <RateTable rates={ratesOf(variant.pricing)} label={`Variant ${key} rates`} />
                <LongPromptStep step={variant.pricing?.longContext} label={`Variant ${key} rates`} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Its record">
        <ReadOnlyFields className="stg:p-4">
          <ReadOnlyField label="Provider API id" mono>
            {baseline.apiModelId || "—"}
          </ReadOnlyField>
          <ReadOnlyField label="Context window">
            {baseline.contextWindowTokens > 0 ? `${formatTokens(baseline.contextWindowTokens)} tokens` : "—"}
          </ReadOnlyField>
          <ReadOnlyField label="Max output">
            {baseline.maxOutputTokens > 0 ? `${formatTokens(baseline.maxOutputTokens)} tokens` : "—"}
          </ReadOnlyField>
          <ReadOnlyField label="Cost tier">{baseline.costTier || "—"}</ReadOnlyField>
          <ReadOnlyField label="Speed tier">{baseline.speedTier || "—"}</ReadOnlyField>
          <ReadOnlyField label="Token counter">{baseline.tokenCounterMethod || "—"}</ReadOnlyField>
          {baseline.featured && <ReadOnlyField label="Featured">In the curated default picker list</ReadOnlyField>}
        </ReadOnlyFields>
      </Section>

      <Section title="Revisions" count={row.history.length}>
        {row.history.length === 0 ? (
          <EmptyState
            variant="first-use"
            size="inline"
            title="No previous revisions — this is the original entry."
          />
        ) : (
          <ul aria-label="Revision history" className="stg:m-0 stg:flex stg:list-none stg:flex-col stg:gap-1 stg:p-4">
            {row.history.map((revision) => (
              <li key={revision.baselineId} className="stg:text-sm stg:text-muted-foreground">
                {revision.status === ModelPricingBaselineStatus.pricing_baseline_retired
                  ? "Retired"
                  : "Superseded"}
                {" · "}
                {formatRate(revision.pricing?.inputPriceMicrosPerMillion ?? ZERO)} in /{" "}
                {formatRate(revision.pricing?.outputPriceMicrosPerMillion ?? ZERO)} out
                {" · "}
                {revision.decidedBy}
                {revision.revisionNote ? ` — ${revision.revisionNote}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
