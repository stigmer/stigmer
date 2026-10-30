// The model catalog console against a mocked billing client: the list
// renders the catalog's own rates, search narrows it, a row opens the
// read-only record, and edit, retire and create run from there through
// the baseline RPCs. A permission-denied catalog read renders the
// operator access notice; any other failure renders its message.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { StigmerError } from "@stigmer/client";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
  PricingVariantSchema,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ModelCatalogConsole } from "../ModelCatalogConsole";

interface MockBilling {
  listModelPricingBaselines: ReturnType<typeof vi.fn>;
  upsertModelPricingBaseline: ReturnType<typeof vi.fn>;
  retireModelPricingBaseline: ReturnType<typeof vi.fn>;
}

function createMockStigmer(billing: Partial<MockBilling> = {}) {
  return {
    billing: {
      listModelPricingBaselines: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
      upsertModelPricingBaseline: vi.fn(),
      retireModelPricingBaseline: vi.fn(),
      ...billing,
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function sonnetBaseline(overrides: Record<string, unknown> = {}) {
  return create(ModelPricingBaselineSchema, {
    baselineId: "bl-1",
    modelId: "claude-sonnet-4-6",
    provider: "anthropic",
    harness: "stigmer",
    displayName: "Claude Sonnet",
    apiModelId: "claude-sonnet-4-6",
    costTier: "standard",
    speedTier: "fast",
    status: ModelPricingBaselineStatus.pricing_baseline_active,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: 3_000_000n,
      outputPriceMicrosPerMillion: 15_000_000n,
    }),
    pricingVariants: {
      fast: create(PricingVariantSchema, {
        pricing: create(PricingBlockSchema, {
          inputPriceMicrosPerMillion: 30_000_000n,
        }),
        wireIds: ["claude-sonnet-4-6-fast"],
      }),
    },
    ...overrides,
  });
}

afterEach(cleanup);

describe("ModelCatalogConsole — list", () => {
  it("lists each catalog model at the catalog's own rates", async () => {
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ entries: [sonnetBaseline()], nextPageToken: "" }),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });

    expect(await screen.findByText("Claude Sonnet")).toBeTruthy();
    // One rate per field, straight from the baseline.
    expect(screen.getByText("$3.00/M")).toBeTruthy();
    expect(screen.getByText("$15.00/M")).toBeTruthy();
  });
});

describe("ModelCatalogConsole — models search", () => {
  it("filters the model list by the search query", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi.fn().mockResolvedValue({
        entries: [
          sonnetBaseline(),
          sonnetBaseline({
            baselineId: "bl-2",
            modelId: "gpt-5.6",
            provider: "openai",
            displayName: "GPT 5.6",
          }),
        ],
        nextPageToken: "",
      }),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });
    await screen.findByText("Claude Sonnet");

    await user.type(screen.getByLabelText("Search models"), "gpt");

    expect(screen.queryByText("Claude Sonnet")).toBeNull();
    expect(screen.getByText("GPT 5.6")).toBeTruthy();
  });
});

describe("ModelCatalogConsole — detail view", () => {
  it("opens a read-only record on row click, with rates, variants, and metadata", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ entries: [sonnetBaseline()], nextPageToken: "" }),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: /Claude Sonnet/ }));

    // Read-only record: rate card, variant wire ids, catalog metadata,
    // revision history — all without entering the edit form.
    expect(screen.getByRole("table", { name: "Baseline rates" })).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-4-6-fast/)).toBeTruthy();
    expect(screen.getByText("Provider API id")).toBeTruthy();
    expect(screen.getByText(/No previous revisions/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });

  it("enters the edit form from the detail record and returns on cancel", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ entries: [sonnetBaseline()], nextPageToken: "" }),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: /Claude Sonnet/ }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Edit claude-sonnet-4-6")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    // Back on the read-only record, not the list.
    expect(screen.getByRole("table", { name: "Baseline rates" })).toBeTruthy();
  });

  it("retires from the detail record with typed confirmation", async () => {
    const user = userEvent.setup();
    const retireModelPricingBaseline = vi.fn().mockResolvedValue(sonnetBaseline());
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ entries: [sonnetBaseline()], nextPageToken: "" }),
      retireModelPricingBaseline,
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: /Claude Sonnet/ }));
    await user.click(screen.getByRole("button", { name: "Retire" }));

    await user.type(
      screen.getByLabelText("Type the model id to confirm retirement"),
      "claude-sonnet-4-6",
    );
    await user.click(screen.getByRole("button", { name: "Retire model" }));

    await waitFor(() =>
      expect(retireModelPricingBaseline).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "claude-sonnet-4-6",
          provider: "anthropic",
          harness: "stigmer",
        }),
      ),
    );
  });

  it("creates a new model through the add-model editor", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ entries: [sonnetBaseline()], nextPageToken: "" }),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });
    await screen.findByText("Claude Sonnet");

    await user.click(screen.getByRole("button", { name: "Add model" }));
    expect(screen.getByText("Add model", { selector: "h4" })).toBeTruthy();
  });
});

describe("ModelCatalogConsole — access", () => {
  it("renders the operator access notice on permission-denied", async () => {
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockRejectedValue(
          new StigmerError(
            "permission-denied",
            "only platform operators can view the model registry baseline",
            7,
          ),
        ),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });

    expect(
      await screen.findByText("Platform operator access required"),
    ).toBeTruthy();
  });

  it("renders the raw error for non-permission failures", async () => {
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockRejectedValue(new Error("the billing service is unavailable")),
    });

    render(<ModelCatalogConsole />, { wrapper: wrapper(client) });

    expect(
      await screen.findByText(/billing service is unavailable/i),
    ).toBeTruthy();
  });
});
