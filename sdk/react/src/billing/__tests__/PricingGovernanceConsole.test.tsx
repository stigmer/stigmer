import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { StigmerError } from "@stigmer/sdk";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
  PricingVariantSchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import {
  ModelPricingGovernanceEntrySchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import {
  ModelPricingOverrideSchema,
  PricingRateField,
} from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PricingGovernanceConsole } from "../PricingGovernanceConsole";

interface MockBilling {
  listModelPricingBaselines: ReturnType<typeof vi.fn>;
  getModelPricingGovernance: ReturnType<typeof vi.fn>;
  decideModelPricingOverride: ReturnType<typeof vi.fn>;
  upsertModelPricingBaseline: ReturnType<typeof vi.fn>;
  retireModelPricingBaseline: ReturnType<typeof vi.fn>;
}

function createMockStigmer(billing: Partial<MockBilling> = {}) {
  return {
    billing: {
      listModelPricingBaselines: vi.fn().mockResolvedValue({ baselines: [] }),
      getModelPricingGovernance: vi
        .fn()
        .mockResolvedValue({ entries: [], pendingOverrides: [] }),
      decideModelPricingOverride: vi.fn(),
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
    harness: "native",
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

function sonnetEntry(overrides: Record<string, unknown> = {}) {
  return create(ModelPricingGovernanceEntrySchema, {
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet",
    provider: "anthropic",
    harness: "native",
    variant: "",
    baselineInputMicrosPerMillion: 3_000_000n,
    baselineOutputMicrosPerMillion: 15_000_000n,
    effectiveInputMicrosPerMillion: 3_000_000n,
    effectiveOutputMicrosPerMillion: 15_000_000n,
    ledgerReconcilable: true,
    ...overrides,
  });
}

function pendingOverride(overrides: Record<string, unknown> = {}) {
  return create(ModelPricingOverrideSchema, {
    overrideId: "ovr-1",
    modelId: "claude-sonnet-4-6",
    rateField: PricingRateField.input,
    rateMicrosPerMillion: 3_200_000n,
    ...overrides,
  });
}

afterEach(cleanup);

describe("PricingGovernanceConsole — tabs", () => {
  it("renders the Models tab with joined effective rates and governance state", async () => {
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
      getModelPricingGovernance: vi.fn().mockResolvedValue({
        // Effective input moved by an active override → baseline shows struck.
        entries: [
          sonnetEntry({
            effectiveInputMicrosPerMillion: 3_500_000n,
            activeOverrides: [pendingOverride()],
          }),
        ],
        pendingOverrides: [],
      }),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });

    expect(await screen.findByText("Claude Sonnet")).toBeTruthy();
    // Effective (overridden) rate and the struck-through baseline.
    expect(screen.getByText("$3.50/M")).toBeTruthy();
    expect(screen.getByText("$3.00/M")).toBeTruthy();
    expect(screen.getByText("Ledger-corrected")).toBeTruthy();
  });

  it("shows the pending sign-off count as the tab badge", async () => {
    const client = createMockStigmer({
      getModelPricingGovernance: vi.fn().mockResolvedValue({
        entries: [],
        pendingOverrides: [pendingOverride(), pendingOverride({ overrideId: "ovr-2" })],
      }),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });

    const signOffsTab = await screen.findByRole("tab", { name: /Sign-Offs/ });
    expect(signOffsTab.textContent).toContain("2");
  });

  it("approves a pending override from the Sign-Offs tab", async () => {
    const user = userEvent.setup();
    const decideModelPricingOverride = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({
      getModelPricingGovernance: vi.fn().mockResolvedValue({
        entries: [],
        pendingOverrides: [pendingOverride()],
      }),
      decideModelPricingOverride,
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });

    await user.click(await screen.findByRole("tab", { name: /Sign-Offs/ }));
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(decideModelPricingOverride).toHaveBeenCalledWith(
        expect.objectContaining({ overrideId: "ovr-1", approve: true }),
      ),
    );
  });
});

describe("PricingGovernanceConsole — models search", () => {
  it("filters the model list by the search query", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi.fn().mockResolvedValue({
        baselines: [
          sonnetBaseline(),
          sonnetBaseline({
            baselineId: "bl-2",
            modelId: "gpt-5.6",
            provider: "openai",
            displayName: "GPT 5.6",
          }),
        ],
      }),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });
    await screen.findByText("Claude Sonnet");

    await user.type(screen.getByLabelText("Search models"), "gpt");

    expect(screen.queryByText("Claude Sonnet")).toBeNull();
    expect(screen.getByText("GPT 5.6")).toBeTruthy();
  });
});

describe("PricingGovernanceConsole — detail view", () => {
  it("opens a read-only record on row click, with rates, variants, and metadata", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
      getModelPricingGovernance: vi.fn().mockResolvedValue({
        entries: [sonnetEntry()],
        pendingOverrides: [],
      }),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: /Claude Sonnet/ }));

    // Read-only record: rate card, variant wire ids, catalog metadata,
    // revision history — all without entering the edit form.
    expect(screen.getByRole("table", { name: "Baseline vs effective rates" })).toBeTruthy();
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
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: /Claude Sonnet/ }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Edit claude-sonnet-4-6")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    // Back on the read-only record, not the list.
    expect(screen.getByRole("table", { name: "Baseline vs effective rates" })).toBeTruthy();
  });

  it("retires from the detail record with typed confirmation", async () => {
    const user = userEvent.setup();
    const retireModelPricingBaseline = vi.fn().mockResolvedValue(sonnetBaseline());
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
      retireModelPricingBaseline,
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });
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
          harness: "native",
        }),
      ),
    );
  });

  it("creates a new model through the add-model editor", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });
    await screen.findByText("Claude Sonnet");

    await user.click(screen.getByRole("button", { name: "Add model" }));
    expect(screen.getByText("Add model", { selector: "h4" })).toBeTruthy();
  });
});

describe("PricingGovernanceConsole — access", () => {
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

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });

    expect(
      await screen.findByText("Platform operator access required"),
    ).toBeTruthy();
  });

  it("renders the raw error for non-permission failures", async () => {
    const client = createMockStigmer({
      getModelPricingGovernance: vi
        .fn()
        .mockRejectedValue(new Error("the governance service is unavailable")),
    });

    render(<PricingGovernanceConsole />, { wrapper: wrapper(client) });

    expect(
      await screen.findByText(/governance service is unavailable/i),
    ).toBeTruthy();
  });
});
