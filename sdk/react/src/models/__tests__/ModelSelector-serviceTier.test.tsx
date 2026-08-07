import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";
import { ModelRegistryContext } from "../ModelRegistryContext";
import type { ModelInfo } from "../registry";

// Portal into document.body so the popover mounts under happy-dom, and shim
// ResizeObserver for Base UI's positioner (the scheduleCreation.test.tsx
// pattern).
vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

/**
 * Service-tier toggle gating (stigmer/stigmer#357).
 *
 * The toggle is capability-gated: it renders only when the consumer opted in
 * (onServiceTierChange) AND the selected model prices a fast variant
 * (ModelInfo.serviceTiers). Switching to a model without a fast tier resets
 * an active fast selection — a stale tier would be refused at create time.
 */

const FAST_CAPABLE: ModelInfo = {
  modelId: "composer-2.5",
  provider: "cursor",
  displayName: "Composer 2.5",
  shortDescription: "Fast agentic model",
  speedTier: "fastest",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: ["fast"],
};

const NO_FAST_TIER: ModelInfo = {
  modelId: "claude-haiku-4-5",
  provider: "anthropic",
  displayName: "Haiku 4.5",
  shortDescription: "Small fast model",
  speedTier: "fastest",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: [],
};

function renderSelector(
  props?: Partial<React.ComponentProps<typeof ModelSelector>>,
) {
  const onValueChange = vi.fn();
  const onServiceTierChange = vi.fn();

  const result = render(
    <ModelRegistryContext.Provider
      value={{
        models: [FAST_CAPABLE, NO_FAST_TIER],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }}
    >
      <ModelSelector
        value="composer-2.5"
        onValueChange={onValueChange}
        harness="cursor"
        serviceTier="standard"
        onServiceTierChange={onServiceTierChange}
        {...props}
      />
    </ModelRegistryContext.Provider>,
  );

  return { ...result, onValueChange, onServiceTierChange };
}

/**
 * Open the popover via its trigger and wait for the portaled popup to
 * mount (Base UI portals render asynchronously in jsdom). The search
 * input is the popup's always-present landmark.
 */
async function openPopover(triggerLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(triggerLabel) }));
  await screen.findByPlaceholderText("Search models…");
}

/** A model row inside the popup list (never matches the trigger). */
function modelOption(displayName: string): HTMLElement {
  const option = screen
    .getAllByText(displayName)
    .map((el) => el.closest<HTMLElement>("[data-model-option]"))
    .find((el) => el != null);
  if (!option) throw new Error(`No popup option for "${displayName}"`);
  return option;
}

afterEach(cleanup);

describe("ModelSelector — service tier toggle", () => {
  it("renders the toggle for a fast-capable model", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    const toggle = screen.getByRole("switch", { name: "Fast tier" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("does not render the toggle for a model without a fast tier", async () => {
    renderSelector({ value: "claude-haiku-4-5" });
    await openPopover("Haiku 4.5");

    expect(screen.queryByRole("switch", { name: "Fast tier" })).toBeNull();
  });

  it("does not render the toggle when the consumer did not opt in", async () => {
    renderSelector({ onServiceTierChange: undefined });
    await openPopover("Composer 2.5");

    expect(screen.queryByRole("switch", { name: "Fast tier" })).toBeNull();
  });

  it("toggling fires onServiceTierChange with the flipped tier", async () => {
    const { onServiceTierChange } = renderSelector();
    await openPopover("Composer 2.5");

    fireEvent.click(screen.getByRole("switch", { name: "Fast tier" }));
    expect(onServiceTierChange).toHaveBeenCalledOnce();
    expect(onServiceTierChange).toHaveBeenCalledWith("fast");
  });

  it("shows the Fast badge on the trigger when the fast tier is active", () => {
    renderSelector({ serviceTier: "fast" });

    expect(screen.getByText("Fast")).toBeTruthy();
  });

  it("resets an active fast tier when selecting a model without one", async () => {
    const { onValueChange, onServiceTierChange } = renderSelector({
      serviceTier: "fast",
    });
    await openPopover("Composer 2.5");

    fireEvent.click(modelOption("Haiku 4.5"));

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(onServiceTierChange).toHaveBeenCalledOnce();
    expect(onServiceTierChange).toHaveBeenCalledWith("standard");
  });

  it("keeps an active fast tier when selecting another fast-capable model", async () => {
    const { onServiceTierChange } = renderSelector({
      serviceTier: "fast",
      value: "claude-haiku-4-5",
    });
    await openPopover("Haiku 4.5");

    fireEvent.click(modelOption("Composer 2.5"));

    expect(onServiceTierChange).not.toHaveBeenCalled();
  });
});
