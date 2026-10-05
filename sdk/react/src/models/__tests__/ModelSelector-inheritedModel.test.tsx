/**
 * The model a run inherits from a less specific layer (an agent's run
 * defaults) in the picker, and the way back to it once the person picked
 * a model.
 *
 * Pins: the "<source>: <model>" entry is listed only when the consumer can
 * act on it (`onInheritedModelSelect`), carries the check while nothing is
 * picked (the inherited model's own row does not, in the curated and the
 * grouped "Show all" views alike), loses it once a model is picked, and
 * choosing it calls back and closes the popover.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";
import { ModelRegistryContext } from "../ModelRegistryContext";
import type { ModelInfo } from "../registry";

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

afterEach(cleanup);

function model(modelId: string, displayName: string, featured: boolean): ModelInfo {
  return {
    modelId,
    provider: "anthropic",
    displayName,
    shortDescription: "",
    speedTier: "fast",
    costTier: "standard",
    harness: "native",
    featured,
    serviceTiers: [],
  };
}

const MODELS = [
  model("claude-sonnet-4-6", "Sonnet 4.6", true),
  model("claude-haiku-4-5", "Haiku 4.5", true),
  model("claude-opus-4-1", "Opus 4.1", false),
];

const INHERITED = { modelId: "claude-sonnet-4-6", source: "Agent default" };

function renderSelector(props: Partial<React.ComponentProps<typeof ModelSelector>>) {
  return render(
    <ModelRegistryContext.Provider
      value={{ models: MODELS, isLoading: false, error: null, refetch: vi.fn() }}
    >
      <ModelSelector onValueChange={vi.fn()} harness="native" {...props} />
    </ModelRegistryContext.Provider>,
  );
}

function selected(name: RegExp | string): string | null {
  return screen.getByRole("option", { name }).getAttribute("aria-selected");
}

describe("ModelSelector — the inherited model", () => {
  it("lists no entry for it when the consumer cannot choose it back", async () => {
    renderSelector({ inheritedModel: INHERITED });

    fireEvent.click(screen.getByRole("button", { name: /Agent default: Sonnet 4\.6/ }));
    await screen.findByRole("option", { name: /Haiku 4\.5/ });
    expect(screen.queryByRole("option", { name: "Agent default: Sonnet 4.6" })).toBeNull();
  });

  it("checks the entry, not the model's row, while nothing is picked, in every view", async () => {
    renderSelector({ inheritedModel: INHERITED, onInheritedModelSelect: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: /Agent default: Sonnet 4\.6/ }));
    await screen.findByRole("option", { name: "Agent default: Sonnet 4.6" });
    expect(selected("Agent default: Sonnet 4.6")).toBe("true");
    expect(selected(/^Sonnet 4\.6/)).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Show all models" }));
    expect(selected("Agent default: Sonnet 4.6")).toBe("true");
    expect(selected(/^Sonnet 4\.6/)).toBe("false");
    expect(selected(/^Opus 4\.1/)).toBe("false");
  });

  it("moves the check to the picked model, and choosing the entry calls back", async () => {
    const onInheritedModelSelect = vi.fn();
    renderSelector({
      value: "claude-haiku-4-5",
      inheritedModel: INHERITED,
      onInheritedModelSelect,
    });

    fireEvent.click(screen.getByRole("button", { name: /Haiku 4\.5/ }));
    await screen.findByRole("option", { name: "Agent default: Sonnet 4.6" });
    expect(selected("Agent default: Sonnet 4.6")).toBe("false");
    expect(selected(/^Haiku 4\.5/)).toBe("true");

    fireEvent.click(screen.getByRole("option", { name: "Agent default: Sonnet 4.6" }));
    expect(onInheritedModelSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("option", { name: "Agent default: Sonnet 4.6" })).toBeNull();
  });
});
