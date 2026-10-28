/**
 * The model picker's readiness marks. Pins that a model whose provider is
 * missing stays listed and selectable, marked in words with what it needs
 * ("Needs an Anthropic key", not an icon alone), and listed after the ready
 * ones in the featured list; that the trigger carries the same mark for the
 * selection, beside the model's whole name; and that a model the server
 * reports unknown, or a picker given no readiness, is never marked. The
 * suite's title holds CON-03 on the UX bar (test/ux-bar.json).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";
import { ModelRegistryContext } from "../ModelRegistryContext";
import type { ModelReadiness, ModelReadinessLookup, ProviderAvailability } from "../readiness";
import { REGISTRY } from "./readiness-fixture";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

const MISSING: ProviderAvailability = { state: "missing", scope: "organization" };
const SERVED: ProviderAvailability = { state: "served", source: "organization", parentOrg: "" };
const UNKNOWN: ProviderAvailability = { state: "unknown" };

/** Readiness where Anthropic stands as `anthropic` and OpenAI as `openai`. */
function lookup(anthropic: ProviderAvailability, openai: ProviderAvailability): ModelReadinessLookup {
  return (harness, modelId): ModelReadiness | undefined => {
    const provider = REGISTRY.models.find((model) => model.harness === harness && model.modelId === modelId)?.provider;
    if (provider === undefined) return undefined;
    return { harness, modelId, provider, availability: provider === "anthropic" ? anthropic : openai };
  };
}

function renderSelector(readinessOf: ModelReadinessLookup | undefined, value = "claude-sonnet-4.6", onValueChange = vi.fn()) {
  render(
    <ModelRegistryContext.Provider value={REGISTRY}>
      <ModelSelector value={value} onValueChange={onValueChange} harness="native" readinessOf={readinessOf} />
    </ModelRegistryContext.Provider>,
  );
  return { onValueChange };
}

async function openPicker() {
  fireEvent.click(screen.getAllByRole("button")[0]);
  await screen.findByPlaceholderText("Search models…");
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-model-option]"));
}

function rowOf(name: string): HTMLElement {
  const row = rows().find((element) => element.textContent?.includes(name));
  if (!row) throw new Error(`No row for ${name}`);
  return row;
}

describe("CON-03 the model picker shows which models are ready", () => {
  it("marks a model whose provider is missing with what it needs, in words", async () => {
    renderSelector(lookup(MISSING, SERVED));
    await openPicker();

    expect(rowOf("Claude Sonnet 4.6").textContent).toContain("Needs an Anthropic key");
    expect(rowOf("GPT-5").textContent).not.toContain("Needs");
  });

  it("lists the ready models first in the featured list, each in the registry's order", async () => {
    renderSelector(lookup(MISSING, SERVED));
    await openPicker();

    expect(rows().map((row) => row.textContent?.includes("GPT-5"))).toEqual([true, false]);
  });

  it("keeps a marked model selectable, since an admin may choose it before its key exists", async () => {
    const { onValueChange } = renderSelector(lookup(MISSING, SERVED), "gpt-5");
    await openPicker();

    fireEvent.click(rowOf("Claude Sonnet 4.6"));

    expect(onValueChange).toHaveBeenCalledWith("claude-sonnet-4.6");
  });

  it("marks the trigger for a selection that cannot run, beside the model's whole name", () => {
    renderSelector(lookup(MISSING, SERVED));

    const trigger = screen.getAllByRole("button")[0];
    expect(within(trigger).getByText("Claude Sonnet 4.6")).toBeTruthy();
    expect(within(trigger).getByText("Needs an Anthropic key")).toBeTruthy();
    // The name keeps its room beside the mark rather than being cut.
    expect(within(trigger).getByText("Claude Sonnet 4.6").className).toContain("stg:sm:shrink-0");
  });

  it("marks nothing the server reports unknown, or when given no readiness", async () => {
    renderSelector(lookup(UNKNOWN, UNKNOWN));
    expect(screen.queryByText("Needs an Anthropic key")).toBeNull();
    await openPicker();
    expect(rows().some((row) => row.textContent?.includes("Needs"))).toBe(false);

    cleanup();
    renderSelector(undefined);
    await openPicker();
    expect(rows().some((row) => row.textContent?.includes("Needs"))).toBe(false);
  });

  it("says an OpenAI model needs an OpenAI key", async () => {
    renderSelector(lookup(SERVED, MISSING));
    await openPicker();

    expect(rowOf("GPT-5").textContent).toContain("Needs an OpenAI key");
    expect(rows().map((row) => row.textContent?.includes("GPT-5"))).toEqual([false, true]);
  });
});
