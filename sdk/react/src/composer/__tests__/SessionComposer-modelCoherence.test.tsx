import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "@stigmer/react-core";
import { SessionComposer } from "../SessionComposer";

// Shim ResizeObserver for Base UI's positioner (the
// routineCreation.test.tsx pattern).
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
 * Effective run selection coherence (stigmer/stigmer#663): the submission
 * must carry exactly the model the pill displays, and "fast" must only
 * ride the wire while the effective model prices it. The original defect:
 * an empty composer displayed the registry fallback with a toggleable
 * FAST badge, then sent `service_tier: fast` with NO model — refused
 * fail-closed by the server ("Couldn't send." + a Retry that can never
 * succeed).
 */

/** The harness default: the featured standard-cost model, with no fast variant. */
const DEFAULT: ModelInfo = {
  modelId: "claude-sonnet-4-6",
  provider: "anthropic",
  displayName: "Sonnet 4.6",
  shortDescription: "Balanced default",
  speedTier: "fast",
  costTier: "standard",
  harness: "stigmer",
  featured: true,
  serviceTiers: [],
};

const FAST_CAPABLE: ModelInfo = {
  modelId: "claude-opus-4-8",
  provider: "anthropic",
  displayName: "Opus 4.8",
  shortDescription: "Frontier model with a fast tier",
  speedTier: "slow",
  costTier: "premium",
  harness: "stigmer",
  featured: true,
  serviceTiers: ["fast"],
};

const NO_FAST: ModelInfo = {
  modelId: "gpt-5.3-codex",
  provider: "openai",
  displayName: "GPT-5.3 Codex",
  shortDescription: "No fast variant",
  speedTier: "fast",
  costTier: "standard",
  harness: "stigmer",
  featured: true,
  serviceTiers: [],
};

function createMinimalStigmerMock(): Stigmer {
  return {
    file: { uploadFile: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    vault: noMyVaultClient(),
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
}

function createWrapper(
  client: Stigmer,
  registry: { models: readonly ModelInfo[]; isLoading?: boolean },
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{
            models: [...registry.models],
            isLoading: registry.isLoading ?? false,
            error: null,
            refetch: vi.fn(),
          }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function submitMessage(message: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
}

/** Open the picker and flip the fast-tier switch (Base UI portals mount
 * asynchronously in jsdom — the switch is awaited). */
async function toggleFastTier(triggerName: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
  const toggle = await screen.findByRole("switch", { name: "Fast tier" });
  fireEvent.click(toggle);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

afterEach(cleanup);

describe("SessionComposer — effective run selection (#663)", () => {
  it("adopts the displayed harness default when no model is selected", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer onSubmit={onSubmit} harness="stigmer" />,
      { wrapper: createWrapper(createMinimalStigmerMock(), { models: [FAST_CAPABLE, DEFAULT, NO_FAST] }) },
    );

    // The pill displays the harness default…
    expect(screen.getByRole("button", { name: /Sonnet 4\.6/ })).toBeTruthy();

    submitMessage("hello");

    // …and the submission carries exactly that model, never undefined.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-sonnet-4-6");
  });

  it("renders no fast-tier switch for a fresh composer whose default prices no fast variant", async () => {
    render(
      <SessionComposer onSubmit={vi.fn()} harness="stigmer" />,
      { wrapper: createWrapper(createMinimalStigmerMock(), { models: [FAST_CAPABLE, DEFAULT, NO_FAST] }) },
    );

    fireEvent.click(screen.getByRole("button", { name: /Sonnet 4\.6/ }));
    // Popover content mounts async; settle on the options area appearing.
    await screen.findByRole("dialog");
    expect(screen.queryByRole("switch", { name: "Fast tier" })).toBeNull();
  });

  it("drops an armed fast tier when a prop-driven model change lands on a model without a fast variant", async () => {
    const onSubmit = vi.fn();
    const wrapper = createWrapper(createMinimalStigmerMock(), {
      models: [FAST_CAPABLE, DEFAULT, NO_FAST],
    });
    const { rerender } = render(
      <SessionComposer onSubmit={onSubmit} harness="stigmer" defaultModelId="claude-opus-4-8" />,
      { wrapper },
    );

    // Arm fast on the fast-capable model (user-driven), then let the host
    // re-sync `defaultModelId` onto a model with no fast variant — the
    // path that bypasses ModelSelector's user-pick reset.
    await toggleFastTier(/Opus 4\.8/);
    rerender(
      <SessionComposer onSubmit={onSubmit} harness="stigmer" defaultModelId="gpt-5.3-codex" />,
    );

    submitMessage("resynced");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("gpt-5.3-codex");
    // The armed tier is unsendable, not just unstyled (#357 fail-closed
    // rule): the person's touched switch rides as what is in effect.
    expect(onSubmit.mock.calls[0][2]?.serviceTier).toBe("standard");
  });

  it("never adopts a default while the model selector is hidden (the hider owns the model)", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer onSubmit={onSubmit} harness="stigmer" showModelSelector={false} />,
      { wrapper: createWrapper(createMinimalStigmerMock(), { models: [FAST_CAPABLE, DEFAULT, NO_FAST] }) },
    );

    submitMessage("guest-shaped send");

    // No pill, no promise: guests' server-side profile (and #664 pins)
    // own the model — the composer must not invent one.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
  });

  it("adopts the displayed default over a model id the registry no longer lists", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer onSubmit={onSubmit} harness="stigmer" defaultModelId="retired-model" />,
      { wrapper: createWrapper(createMinimalStigmerMock(), { models: [FAST_CAPABLE, DEFAULT, NO_FAST] }) },
    );

    submitMessage("stale id");

    // The pill cannot display "retired-model" (unknown → falls back to the
    // harness default), so the payload must not carry it either.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-sonnet-4-6");
  });

  it("passes the raw model id through while the registry is still loading", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer onSubmit={onSubmit} harness="stigmer" defaultModelId="claude-opus-4-8" />,
      { wrapper: createWrapper(createMinimalStigmerMock(), { models: [], isLoading: true }) },
    );

    submitMessage("early send");

    // Nothing can be classified mid-load: adopt nothing, rewrite nothing.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-opus-4-8");
  });
});
