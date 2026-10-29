/**
 * Pins ModelCatalogDetail's revision history: each earlier revision of the
 * model reads as one line naming whether it was superseded or retired, its
 * input and output rates, who decided it and the note they left.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
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
  key: "claude-sonnet-4-6|anthropic|native",
  baseline: baseline("bl-3", ModelPricingBaselineStatus.pricing_baseline_active, 3_000_000n, "ops@acme", ""),
  history: [
    baseline("bl-2", ModelPricingBaselineStatus.pricing_baseline_superseded, 2_500_000n, "ops@acme", "vendor price rise"),
    baseline("bl-1", ModelPricingBaselineStatus.pricing_baseline_retired, 2_000_000n, "finance@acme", ""),
  ],
};

afterEach(cleanup);

describe("ModelCatalogDetail revision history", () => {
  it("reads each earlier revision as its fate, rates, decider and note", () => {
    render(<ModelCatalogDetail row={ROW} onEdit={vi.fn()} onRetire={vi.fn()} onBack={vi.fn()} />);

    const history = screen.getByRole("region", { name: "Revision history" });
    expect(within(history).queryByText(/No previous revisions/)).toBeNull();
    expect(within(history).getByText(/^Superseded/).textContent).toBe(
      "Superseded · $2.50/M in / $15.00/M out · ops@acme — vendor price rise",
    );
    expect(within(history).getByText(/^Retired/).textContent).toBe(
      "Retired · $2.00/M in / $15.00/M out · finance@acme",
    );
  });
});
