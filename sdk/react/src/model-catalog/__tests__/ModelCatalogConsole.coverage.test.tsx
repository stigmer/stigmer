// The model catalog console's zero-results act: a model search that
// matches nothing names the search, and "Clear search" empties the box so
// every catalog model is listed again.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ModelCatalogConsole } from "../ModelCatalogConsole";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const sonnet = create(ModelPricingBaselineSchema, {
  baselineId: "bl-1",
  modelId: "claude-sonnet-4-6",
  provider: "anthropic",
  harness: "stigmer",
  displayName: "Claude Sonnet",
  apiModelId: "claude-sonnet-4-6",
  status: ModelPricingBaselineStatus.pricing_baseline_active,
  pricing: create(PricingBlockSchema, {
    inputPriceMicrosPerMillion: 3_000_000n,
    outputPriceMicrosPerMillion: 15_000_000n,
  }),
});

afterEach(cleanup);

describe("ModelCatalogConsole — models search", () => {
  it("names a search that matches no model, and Clear search lists them again", async () => {
    const user = userEvent.setup();
    const client = {
      billing: {
        listModelPricingBaselines: vi.fn().mockResolvedValue({ entries: [sonnet], nextPageToken: "" }),
        upsertModelPricingBaseline: vi.fn(),
        retireModelPricingBaseline: vi.fn(),
      },
    };

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });
    await screen.findByText("Claude Sonnet");

    const search = screen.getByLabelText("Search models") as HTMLInputElement;
    await user.type(search, "llama");

    expect(await screen.findByText("Nothing matches “llama”")).toBeTruthy();
    expect(screen.queryByText("Claude Sonnet")).toBeNull();

    await user.click(screen.getByText("Clear search", { selector: "button" }));

    expect(search.value).toBe("");
    expect(await screen.findByText("Claude Sonnet")).toBeTruthy();
    expect(screen.queryByText("Nothing matches “llama”")).toBeNull();
  });
});
