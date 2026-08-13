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
 * "No image input" indicator on model rows (stigmer/stigmer#386).
 *
 * Tri-state contract: the indicator renders ONLY for models the registry
 * explicitly assessed as blind (`visionCapability === false`). A sighted
 * model shows nothing, and — the load-bearing case — an UNASSESSED model
 * (absent capabilities block) also shows nothing: most registry entries
 * were never capability-assessed, and flagging them all as blind would
 * be wrong for nearly every one.
 */

const BLIND: ModelInfo = {
  modelId: "kimi-k3",
  provider: "moonshot",
  displayName: "Kimi K3",
  shortDescription: "Text-only economy model",
  speedTier: "fast",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: [],
  visionCapability: false,
};

const SIGHTED: ModelInfo = {
  modelId: "composer-2.5",
  provider: "cursor",
  displayName: "Composer 2.5",
  shortDescription: "Fast agentic model",
  speedTier: "fastest",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: [],
  visionCapability: true,
};

const UNASSESSED: ModelInfo = {
  modelId: "mystery-model",
  provider: "cursor",
  displayName: "Mystery Model",
  shortDescription: "Never capability-assessed",
  speedTier: "fast",
  costTier: "standard",
  harness: "cursor",
  featured: true,
  serviceTiers: [],
};

function renderSelector() {
  return render(
    <ModelRegistryContext.Provider
      value={{
        models: [BLIND, SIGHTED, UNASSESSED],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }}
    >
      <ModelSelector
        value="composer-2.5"
        onValueChange={vi.fn()}
        harness="cursor"
      />
    </ModelRegistryContext.Provider>,
  );
}

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

describe("ModelSelector — no-image-input indicator", () => {
  it("marks an explicitly blind model with visible badge text", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    // Visible text, not a tooltip — keyboard and touch users must see it
    // before picking the model (stigmer/no-native-title).
    const row = modelOption("Kimi K3");
    expect(row.textContent).toContain("No image input");
  });

  it("shows nothing on an explicitly sighted model", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    expect(modelOption("Composer 2.5").textContent).not.toContain("No image input");
  });

  it("shows nothing on an unassessed model (tri-state: absent is not false)", async () => {
    renderSelector();
    await openPopover("Composer 2.5");

    expect(modelOption("Mystery Model").textContent).not.toContain("No image input");
  });
});
