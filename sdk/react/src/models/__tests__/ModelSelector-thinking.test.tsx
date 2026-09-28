import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";
import { ModelRegistryContext } from "../ModelRegistryContext";
import type { ModelInfo } from "../registry";
import { thinkingLocked, thinkingSelectable } from "../thinking-mode";

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
 * The thinking switch in the popover's options area (stigmer/stigmer#772,
 * stigmer/stigmer#1280), the fast tier's twin. It renders for a model whose
 * entry declares a thinking form, on either harness, and never for one that
 * declares none (no dead controls). A model that always thinks shows it on
 * and locked. An enabled mode resets only when the chosen model cannot
 * think, where the selection would be refused at create time.
 */

const NATIVE_ADAPTIVE: ModelInfo = {
  modelId: "claude-sonnet-5",
  provider: "anthropic",
  displayName: "Claude Sonnet 5",
  shortDescription: "Latest Sonnet",
  speedTier: "fast",
  costTier: "standard",
  harness: "native",
  featured: true,
  serviceTiers: [],
  thinkingCapable: true,
  thinkingRequired: false,
};

const NATIVE_ALWAYS_THINKS: ModelInfo = {
  modelId: "claude-fable-5",
  provider: "anthropic",
  displayName: "Claude Fable 5",
  shortDescription: "Always reasons",
  speedTier: "slow",
  costTier: "premium",
  harness: "native",
  featured: true,
  serviceTiers: [],
  thinkingCapable: true,
  thinkingRequired: true,
};

const NATIVE_UNASSESSED: ModelInfo = {
  modelId: "claude-unassessed",
  provider: "anthropic",
  displayName: "Local Model",
  shortDescription: "Never assessed",
  speedTier: "fast",
  costTier: "economy",
  harness: "native",
  featured: true,
  serviceTiers: [],
};

function renderSelector(props?: Partial<React.ComponentProps<typeof ModelSelector>>) {
  const onValueChange = vi.fn();
  const onThinkingModeChange = vi.fn();

  const result = render(
    <ModelRegistryContext.Provider
      value={{
        models: [NATIVE_ADAPTIVE, NATIVE_ALWAYS_THINKS, NATIVE_UNASSESSED],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }}
    >
      <ModelSelector
        value="claude-sonnet-5"
        onValueChange={onValueChange}
        harness="native"
        thinkingMode="disabled"
        onThinkingModeChange={onThinkingModeChange}
        {...props}
      />
    </ModelRegistryContext.Provider>,
  );

  return { ...result, onValueChange, onThinkingModeChange };
}

async function openPopover(triggerLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(triggerLabel) }));
  await screen.findByPlaceholderText("Search models…");
}

function modelOption(displayName: string): HTMLElement {
  const option = screen
    .getAllByText(displayName)
    .map((el) => el.closest<HTMLElement>("[data-model-option]"))
    .find((el) => el != null);
  if (!option) throw new Error(`No popup option for "${displayName}"`);
  return option;
}

afterEach(cleanup);

describe("thinkingSelectable and thinkingLocked", () => {
  it("read the entry's own flags, with no harness check", () => {
    expect(thinkingSelectable(NATIVE_ADAPTIVE)).toBe(true);
    expect(thinkingSelectable({ ...NATIVE_ADAPTIVE, harness: "cursor" })).toBe(true);
    expect(thinkingSelectable(NATIVE_UNASSESSED)).toBe(false);
    expect(thinkingSelectable({ ...NATIVE_ADAPTIVE, thinkingCapable: false })).toBe(false);
    expect(thinkingLocked(NATIVE_ALWAYS_THINKS)).toBe(true);
    expect(thinkingLocked(NATIVE_ADAPTIVE)).toBe(false);
    expect(thinkingLocked(NATIVE_UNASSESSED)).toBe(false);
  });
});

describe("ModelSelector — thinking switch", () => {
  it("renders the switch for a native model that declares a thinking form, and toggles it", async () => {
    const { onThinkingModeChange } = renderSelector();
    await openPopover("Claude Sonnet 5");

    const toggle = screen.getByRole("switch", { name: "Thinking" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onThinkingModeChange).toHaveBeenCalledWith("enabled");
  });

  it("renders no switch for a model never assessed for thinking", async () => {
    renderSelector({ value: "claude-unassessed" });
    await openPopover("Local Model");

    expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();
  });

  it("shows a model that always thinks on and locked, whatever the mode holds", async () => {
    const { onThinkingModeChange } = renderSelector({ value: "claude-fable-5", thinkingMode: "disabled" });
    await openPopover("Claude Fable 5");

    const toggle = screen.getByRole("switch", { name: "Thinking" }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onThinkingModeChange).not.toHaveBeenCalled();
  });

  it("keeps an enabled mode across thinking-capable models, and resets it on one that cannot think", async () => {
    const { onThinkingModeChange } = renderSelector({ thinkingMode: "enabled" });

    await openPopover("Claude Sonnet 5");
    fireEvent.click(modelOption("Claude Fable 5"));
    expect(onThinkingModeChange).not.toHaveBeenCalled();

    await openPopover("Claude Sonnet 5");
    fireEvent.click(modelOption("Local Model"));
    expect(onThinkingModeChange).toHaveBeenCalledWith("disabled");
  });
});
