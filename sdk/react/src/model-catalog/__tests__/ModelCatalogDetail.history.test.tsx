/**
 * Pins ModelCatalogDetail's revision history: each earlier revision of the
 * model reads as one line naming whether it was superseded or retired, its
 * input and output rates, who decided it and the note they left. And the
 * long-prompt step (stigmer#3138): a model priced by prompt length shows the
 * higher rates under its own, headed by the threshold grouped by thousands,
 * on the base block and on each variant; a model without one shows nothing
 * more. And where the rates came from: a provider's list price as a sentence
 * naming the provider, any other source as written.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  LongContextPricingSchema,
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
  PricingVariantSchema,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { ModelCatalogDetail } from "../ModelCatalogDetail";
import type { ModelCatalogRow } from "../useModelCatalogView";

function baseline(id: string, status: ModelPricingBaselineStatus, input: bigint, decidedBy: string, revisionNote: string) {
  return create(ModelPricingBaselineSchema, {
    baselineId: id,
    modelId: "claude-sonnet-4-6",
    provider: "anthropic",
    harness: "stigmer",
    displayName: "Claude Sonnet",
    status,
    decidedBy,
    revisionNote,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: input,
      outputPriceMicrosPerMillion: 15_000_000n,
    }),
  });
}

const ROW: ModelCatalogRow = {
  key: "claude-sonnet-4-6|anthropic|stigmer",
  baseline: baseline("bl-3", ModelPricingBaselineStatus.pricing_baseline_active, 3_000_000n, "ops@acme", ""),
  history: [
    baseline("bl-2", ModelPricingBaselineStatus.pricing_baseline_superseded, 2_500_000n, "ops@acme", "vendor price rise"),
    baseline("bl-1", ModelPricingBaselineStatus.pricing_baseline_retired, 2_000_000n, "finance@acme", ""),
  ],
};

afterEach(cleanup);

describe("ModelCatalogDetail revision history", () => {
  it("reads each earlier revision as its fate, rates, decider and note", () => {
    render(<ModelCatalogDetail row={ROW} />);

    const history = screen.getByRole("list", { name: "Revision history" });
    expect(within(history).queryByText(/No previous revisions/)).toBeNull();
    expect(within(history).getByText(/^Superseded/).textContent).toBe(
      "Superseded · $2.50/M in / $15.00/M out · ops@acme — vendor price rise",
    );
    expect(within(history).getByText(/^Retired/).textContent).toBe(
      "Retired · $2.00/M in / $15.00/M out · finance@acme",
    );
  });
});

describe("ModelCatalogDetail long-prompt step", () => {
  const step = (input: bigint) =>
    create(LongContextPricingSchema, {
      thresholdTokens: 100_000,
      inputPriceMicrosPerMillion: input,
      outputPriceMicrosPerMillion: input * 5n,
      cacheWritePriceMicrosPerMillion: (input * 5n) / 4n,
      cacheReadPriceMicrosPerMillion: input / 10n,
    });
  const STEPPED: ModelCatalogRow = {
    ...ROW,
    history: [],
    baseline: create(ModelPricingBaselineSchema, {
      ...ROW.baseline,
      pricing: create(PricingBlockSchema, {
        inputPriceMicrosPerMillion: 1_000_000n,
        outputPriceMicrosPerMillion: 5_000_000n,
        longContext: step(5_000_000n),
      }),
      pricingVariants: {
        batch: create(PricingVariantSchema, {
          pricing: create(PricingBlockSchema, {
            inputPriceMicrosPerMillion: 2_000_000n,
            outputPriceMicrosPerMillion: 10_000_000n,
            longContext: step(10_000_000n),
          }),
          wireIds: ["claude-haiku-5.5-batch"],
        }),
      },
    }),
  };

  it("shows the step's rates under the four rates, on the base block and each variant", () => {
    render(<ModelCatalogDetail row={STEPPED} />);

    const base = screen.getByRole("table", { name: "Baseline rates, above 100,000 prompt tokens" });
    expect(within(base).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "$5.00/M",
      "$25.00/M",
      "$6.25/M",
      "$0.50/M",
    ]);
    const variant = screen.getByRole("table", { name: "Variant batch rates, above 100,000 prompt tokens" });
    expect(within(variant).getAllByRole("cell")[0]!.textContent).toBe("$10.00/M");
    expect(screen.getAllByText("Above 100,000 prompt tokens")).toHaveLength(2);
  });

  it("shows nothing more for a model without a step", () => {
    render(<ModelCatalogDetail row={ROW} />);
    expect(screen.getByRole("table", { name: "Baseline rates" })).toBeTruthy();
    expect(screen.queryByText(/prompt tokens/)).toBeNull();
  });
});

describe("ModelCatalogDetail provenance", () => {
  it("says where the rates came from and when, in one quiet line", () => {
    const sourced: ModelCatalogRow = {
      ...ROW,
      history: [],
      baseline: create(ModelPricingBaselineSchema, {
        ...ROW.baseline,
        pricing: create(PricingBlockSchema, {
          inputPriceMicrosPerMillion: 3_000_000n,
          outputPriceMicrosPerMillion: 15_000_000n,
          source: "anthropic.com/pricing",
          effectiveAt: timestampFromDate(new Date(Date.UTC(2026, 0, 2))),
        }),
      }),
    };
    render(<ModelCatalogDetail row={sourced} />);
    expect(screen.getByText("Source: anthropic.com/pricing · Jan 2, 2026")).toBeTruthy();
  });

  it("says a provider's list price as a sentence naming the provider", () => {
    const listed = (source: string, effectiveAt?: Date): ModelCatalogRow => ({
      ...ROW,
      history: [],
      baseline: create(ModelPricingBaselineSchema, {
        ...ROW.baseline,
        pricing: create(PricingBlockSchema, {
          inputPriceMicrosPerMillion: 3_000_000n,
          outputPriceMicrosPerMillion: 15_000_000n,
          source,
          effectiveAt: effectiveAt ? timestampFromDate(effectiveAt) : undefined,
        }),
      }),
    });
    render(<ModelCatalogDetail row={listed("anthropic list price", new Date(Date.UTC(2026, 3, 21)))} />);
    expect(screen.getByText("List prices from Anthropic, Apr 21, 2026.")).toBeTruthy();
    expect(screen.queryByText(/^Source:/)).toBeNull();
    cleanup();

    // The provider is named as the console names it elsewhere, and a list price without a date ends there.
    render(<ModelCatalogDetail row={listed("openai list price")} />);
    expect(screen.getByText("List prices from OpenAI.")).toBeTruthy();
  });
});
