/**
 * The public pricing page: static copy that explains how a run is billed,
 * and a per-model table loaded from the cloud's public pricing endpoint.
 *
 * Pins the billing story the page tells (a run's LLM calls are metered and
 * debited; a run in progress stops gracefully when the balance runs out),
 * that it asks the cloud API's public model-pricing endpoint, that a failed
 * load leaves the copy up and hides only the table and calculator, and that
 * loaded entries reach the table.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { PricingPage } from "../PricingPage";
import type { ModelPricingEntry } from "../pricing/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ENTRY: ModelPricingEntry = {
  modelId: "claude-sonnet-4-6",
  displayName: "Claude 4.6 Sonnet",
  provider: "anthropic",
  harness: "cursor",
  costTier: "standard",
  inputPriceMicrosPerMillion: 3_300_000,
  outputPriceMicrosPerMillion: 16_500_000,
  cacheCreationPriceMicrosPerMillion: 0,
  cacheReadPriceMicrosPerMillion: 0,
  pricingPolicyId: "default",
  markupBasisPoints: 1000,
};

describe("PricingPage", () => {
  it("explains run metering and keeps its copy when the pricing load fails", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);

    render(<PricingPage />);

    expect(fetchMock).toHaveBeenCalledWith(`${SITE_CONFIG.cloudApiUrl}/api/v1/public/model-pricing`);
    expect(screen.getByText("Run agents, pay per LLM call")).toBeTruthy();
    expect(
      screen.getByText(
        "Each LLM call during a run is metered and debited from your balance at transparent per-token rates.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("What happens when my balance runs out?")).toBeTruthy();
    expect(
      screen.getByText(
        "Runs in progress will finish their current LLM call, then stop gracefully. You will see low-balance warnings before that happens. New runs cannot start until credits are added.",
      ),
    ).toBeTruthy();
    // Let the refused load settle (the page marks pricing loaded, with no rows).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Per-Model Pricing")).toBeNull();
    expect(screen.queryByText("Estimate Your Cost")).toBeNull();
  });

  it("shows the loaded models in the per-model table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ entries: [ENTRY] }))),
    );

    render(<PricingPage />);

    expect(await screen.findByText("Per-Model Pricing")).toBeTruthy();
    expect(screen.getAllByText("Claude 4.6 Sonnet").length).toBeGreaterThan(0);
  });
});
