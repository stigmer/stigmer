import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ModelCatalogPanel } from "../ModelCatalogPanel";

interface MockBilling {
  listModelPricingBaselines: ReturnType<typeof vi.fn>;
  upsertModelPricingBaseline: ReturnType<typeof vi.fn>;
  retireModelPricingBaseline: ReturnType<typeof vi.fn>;
}

function createMockStigmer(billing: Partial<MockBilling> = {}) {
  return {
    billing: {
      listModelPricingBaselines: vi.fn().mockResolvedValue({ baselines: [] }),
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
    harness: "cursor",
    displayName: "Claude 4.6 Sonnet",
    costTier: "standard",
    speedTier: "fast",
    featured: true,
    status: ModelPricingBaselineStatus.pricing_baseline_active,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: 3_000_000n,
      outputPriceMicrosPerMillion: 15_000_000n,
      cacheWritePriceMicrosPerMillion: 3_750_000n,
      cacheReadPriceMicrosPerMillion: 300_000n,
      cursorTokenRateMicrosPerMillion: 250_000n,
    }),
    pricingVariants: {
      fast: create(PricingVariantSchema, {
        pricing: create(PricingBlockSchema, {
          inputPriceMicrosPerMillion: 30_000_000n,
          outputPriceMicrosPerMillion: 150_000_000n,
        }),
        wireIds: ["claude-sonnet-4-6-fast"],
      }),
    },
    ...overrides,
  });
}

describe("ModelCatalogPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // The shared vitest config has no `globals`, so testing-library's
  // auto-cleanup never registers — unmount explicitly or panels from
  // earlier tests stay mounted and queries collide.
  afterEach(cleanup);

  it("renders the ACTIVE catalog with rates", async () => {
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
    });

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });

    expect(await screen.findByText("Claude 4.6 Sonnet")).toBeTruthy();
    expect(screen.getByText("$3.00/M")).toBeTruthy();
    expect(screen.getByText("$15.00/M")).toBeTruthy();
  });

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

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });

    expect(
      await screen.findByText("Platform operator access required"),
    ).toBeTruthy();
  });

  it("renders the raw error for non-permission failures", async () => {
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockRejectedValue(new Error("the registry service is unavailable")),
    });

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });

    expect(
      await screen.findByText(/registry service is unavailable/i),
    ).toBeTruthy();
  });

  it("requires the rate-change confirmation before submitting an edit", async () => {
    const user = userEvent.setup();
    const upsertModelPricingBaseline = vi.fn().mockResolvedValue(sonnetBaseline());
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
      upsertModelPricingBaseline,
    });

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    // Raise the input rate 3.00 → 4.50. The base "Input" field comes
    // before the variant's in DOM order.
    const inputRate = screen.getAllByLabelText("Input")[0];
    await user.clear(inputRate);
    await user.type(inputRate, "4.5");
    await user.click(screen.getByRole("button", { name: "Review changes" }));

    // Nothing submitted yet — the confirm step shows the old → new diff.
    expect(upsertModelPricingBaseline).not.toHaveBeenCalled();
    expect(await screen.findByText(/Confirm baseline revision/)).toBeTruthy();
    expect(screen.getByText("$4.50/M")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Apply revision" }));
    await waitFor(() => expect(upsertModelPricingBaseline).toHaveBeenCalledTimes(1));

    const submitted = upsertModelPricingBaseline.mock.calls[0][0];
    expect(submitted.baseline.pricing.inputPriceMicrosPerMillion).toBe(4_500_000n);
    // Untouched rates and identity survive the edit round-trip.
    expect(submitted.baseline.pricing.cursorTokenRateMicrosPerMillion).toBe(250_000n);
    expect(submitted.baseline.modelId).toBe("claude-sonnet-4-6");
    // The variant (and its wire ids) survive too.
    expect(submitted.baseline.pricingVariants.fast.wireIds).toEqual([
      "claude-sonnet-4-6-fast",
    ]);
  });

  it("rejects invalid rates client-side before any RPC", async () => {
    const user = userEvent.setup();
    const upsertModelPricingBaseline = vi.fn();
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
      upsertModelPricingBaseline,
    });

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const inputRate = screen.getAllByLabelText("Input")[0];
    await user.clear(inputRate);
    await user.type(inputRate, "-3");
    await user.click(screen.getByRole("button", { name: "Review changes" }));

    expect(await screen.findByText(/must be a non-negative dollar amount/)).toBeTruthy();
    expect(upsertModelPricingBaseline).not.toHaveBeenCalled();
  });

  it("retire requires typing the model id", async () => {
    const user = userEvent.setup();
    const retireModelPricingBaseline = vi.fn().mockResolvedValue(sonnetBaseline());
    const client = createMockStigmer({
      listModelPricingBaselines: vi
        .fn()
        .mockResolvedValue({ baselines: [sonnetBaseline()] }),
      retireModelPricingBaseline,
    });

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });
    await user.click(await screen.findByRole("button", { name: "Retire" }));

    const confirmButton = screen.getByRole("button", { name: "Retire model" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(
      screen.getByLabelText("Type the model id to confirm retirement"),
      "claude-sonnet-4-6",
    );
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(confirmButton);
    await waitFor(() => expect(retireModelPricingBaseline).toHaveBeenCalledTimes(1));
    expect(retireModelPricingBaseline.mock.calls[0][0]).toMatchObject({
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
      harness: "cursor",
    });
  });

  it("shows superseded revisions when history is enabled", async () => {
    const user = userEvent.setup();
    const active = sonnetBaseline();
    const superseded = sonnetBaseline({
      baselineId: "bl-0",
      status: ModelPricingBaselineStatus.pricing_baseline_superseded,
      decidedBy: "ia-operator-1",
      revisionNote: "Launch pricing",
    });
    const listModelPricingBaselines = vi
      .fn()
      .mockImplementation(({ includeHistory }: { includeHistory: boolean }) =>
        Promise.resolve({
          baselines: includeHistory ? [active, superseded] : [active],
        }),
      );
    const client = createMockStigmer({ listModelPricingBaselines });

    render(<ModelCatalogPanel />, { wrapper: wrapper(client) });
    await screen.findByText("Claude 4.6 Sonnet");

    await user.click(screen.getByLabelText("Show revision history"));
    expect(await screen.findByText(/Superseded/)).toBeTruthy();
    expect(screen.getByText(/Launch pricing/)).toBeTruthy();
    expect(listModelPricingBaselines).toHaveBeenLastCalledWith({ includeHistory: true });
  });
});
