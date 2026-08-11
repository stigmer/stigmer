import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";
import { ModelRegistryContext } from "../ModelRegistryContext";
import type { ModelInfo } from "../registry";

// Shim ResizeObserver for Base UI's positioner (the
// scheduleCreation.test.tsx pattern).
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
 * Fast-tier switch in the popover's options area (stigmer/stigmer#357).
 *
 * The switch sits at the TOP of the popover (the Cursor options-panel
 * convention) and is capability-gated: it renders only when the consumer
 * opted in (onServiceTierChange) AND the selected model prices a fast
 * variant (ModelInfo.serviceTiers) — no dead controls. An active fast
 * tier persists across switches between fast-capable models (the trigger
 * badge and the switch keep the state visible), and resets ONLY when the
 * chosen model prices no fast variant — a stale tier there would be
 * refused at create time.
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

const ALSO_FAST_CAPABLE: ModelInfo = {
  modelId: "claude-opus-4-8",
  provider: "anthropic",
  displayName: "Claude 4.8 Opus",
  shortDescription: "Frontier Opus via Cursor",
  speedTier: "slow",
  costTier: "premium",
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
        models: [FAST_CAPABLE, ALSO_FAST_CAPABLE, NO_FAST_TIER],
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

describe("ModelSelector — fast tier switch in the options area", () => {
  it("renders the switch for a fast-capable selected model", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    const toggle = screen.getByRole("switch", { name: "Fast tier" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("places the switch in the options area above the model list", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    const toggle = screen.getByRole("switch", { name: "Fast tier" });
    const search = screen.getByRole("searchbox", { name: "Search models" });
    // DOCUMENT_POSITION_FOLLOWING: the search input comes after the switch,
    // i.e. the options area precedes search + list (never a footer).
    expect(
      toggle.compareDocumentPosition(search)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not render the switch for a model without a fast tier", async () => {
    renderSelector({ value: "claude-haiku-4-5" });
    await openPopover("Haiku 4.5");

    expect(screen.queryByRole("switch", { name: "Fast tier" })).toBeNull();
  });

  it("does not render the switch when the consumer did not opt in", async () => {
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

  it("toggling off an active fast tier fires 'standard'", async () => {
    const { onServiceTierChange } = renderSelector({ serviceTier: "fast" });
    await openPopover("Composer 2.5");

    fireEvent.click(screen.getByRole("switch", { name: "Fast tier" }));
    expect(onServiceTierChange).toHaveBeenCalledOnce();
    expect(onServiceTierChange).toHaveBeenCalledWith("standard");
  });

  it("keeps the popover open across a toggle", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    fireEvent.click(screen.getByRole("switch", { name: "Fast tier" }));
    expect(screen.getByPlaceholderText("Search models…")).toBeTruthy();
  });
});

describe("ModelSelector — trigger badge", () => {
  it("shows the Fast badge on the trigger when the fast tier is active", () => {
    renderSelector({ serviceTier: "fast" });

    expect(screen.getByText("Fast")).toBeTruthy();
  });

  it("hides the badge when the selected model has no fast tier", () => {
    renderSelector({ serviceTier: "fast", value: "claude-haiku-4-5" });

    expect(screen.queryByText("Fast")).toBeNull();
  });
});

describe("ModelSelector — fast tier persistence across model switches", () => {
  it("selecting a model while standard emits no tier change", async () => {
    const { onValueChange, onServiceTierChange } = renderSelector();
    await openPopover("Composer 2.5");

    fireEvent.click(modelOption("Composer 2.5"));

    expect(onValueChange).toHaveBeenCalledWith("composer-2.5");
    expect(onServiceTierChange).not.toHaveBeenCalled();
  });

  it("keeps an active fast tier when selecting another fast-capable model", async () => {
    // "Fast, but on that other model" is one action — resetting here made
    // users re-toggle on every model change, and the tier is never silent
    // (trigger badge + options switch both show it).
    const { onValueChange, onServiceTierChange } = renderSelector({
      serviceTier: "fast",
    });
    await openPopover("Composer 2.5");

    fireEvent.click(modelOption("Claude 4.8 Opus"));

    expect(onValueChange).toHaveBeenCalledWith("claude-opus-4-8");
    expect(onServiceTierChange).not.toHaveBeenCalled();
  });

  it("toggle-then-pick works in a single popover visit", async () => {
    // Flip the switch first (popover stays open), then pick a fast-capable
    // model: the toggle survives the selection.
    const { onValueChange, onServiceTierChange } = renderSelector();
    await openPopover("Composer 2.5");

    fireEvent.click(screen.getByRole("switch", { name: "Fast tier" }));
    fireEvent.click(modelOption("Claude 4.8 Opus"));

    expect(onServiceTierChange).toHaveBeenCalledOnce();
    expect(onServiceTierChange).toHaveBeenCalledWith("fast");
    expect(onValueChange).toHaveBeenCalledWith("claude-opus-4-8");
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
});
