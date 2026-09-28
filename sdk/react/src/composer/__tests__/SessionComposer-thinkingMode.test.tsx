import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import { SessionComposer } from "../SessionComposer";

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
 * End-to-end composer wiring for the thinking mode (stigmer/stigmer#772) —
 * the SessionComposer-serviceTier twin. The toolbar's ModelSelector toggle
 * must reach composer state, and an active enabled selection must ride the
 * submit context to execution create. This seam (SessionComposer →
 * ComposerToolbar props → submit context) is exactly where the #357 tier
 * toggle originally shipped dead while every layer unit-tested green.
 */

const THINKING_CAPABLE: ModelInfo = {
  modelId: "claude-haiku-4-5",
  provider: "anthropic",
  displayName: "Haiku 4.5",
  shortDescription: "Fast Claude with optional thinking",
  speedTier: "fast",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: [],
  thinkingCapable: true,
};

const NOT_CAPABLE: ModelInfo = {
  modelId: "composer-2.5",
  provider: "cursor",
  displayName: "Composer 2.5",
  shortDescription: "Fast agentic model",
  speedTier: "fastest",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: ["fast"],
  thinkingCapable: false,
};

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

function createMinimalStigmerMock(): Stigmer {
  return {
    agentExecution: { uploadAttachment: vi.fn() },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{
            models: [THINKING_CAPABLE, NOT_CAPABLE, NATIVE_ADAPTIVE, NATIVE_ALWAYS_THINKS],
            isLoading: false,
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

function renderComposer(defaultModelId = "claude-haiku-4-5", harness: "cursor" | "native" = "cursor") {
  const client = createMinimalStigmerMock();
  const onSubmit = vi.fn();

  const result = render(
    <SessionComposer
      onSubmit={onSubmit}
      harness={harness}
      defaultModelId={defaultModelId}
    />,
    { wrapper: createWrapper(client) },
  );

  return { ...result, onSubmit };
}

function submitMessage(message: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
}

/**
 * Open the model selector popover (Base UI portals mount asynchronously in
 * jsdom — the switch is awaited) and flip the thinking switch in the
 * options area, then close the popover (toggling keeps it open).
 */
async function toggleThinking(triggerName: RegExp = /Haiku 4\.5/) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
  const toggle = await screen.findByRole("switch", { name: "Thinking" });
  fireEvent.click(toggle);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

afterEach(cleanup);

describe("SessionComposer — thinking mode submit contract", () => {
  it("renders the thinking switch through the toolbar for a capable model", async () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: /Haiku 4\.5/ }));
    expect(await screen.findByRole("switch", { name: "Thinking" })).toBeTruthy();
  });

  it("renders no thinking switch for a model without the capability", async () => {
    renderComposer("composer-2.5");

    fireEvent.click(screen.getByRole("button", { name: /Composer 2\.5/ }));
    // The fast switch proves the options area itself rendered — only the
    // thinking row must be absent (no dead controls).
    await screen.findByRole("switch", { name: "Fast tier" });
    expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();
  });

  it("carries thinkingMode 'enabled' on the submit context after toggling", async () => {
    const { onSubmit } = renderComposer();

    await toggleThinking();
    submitMessage("Think hard about this");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.thinkingMode).toBe("enabled");
  });

  it("leaves thinkingMode undefined when the switch is untouched", async () => {
    const { onSubmit } = renderComposer();

    submitMessage("Just answer");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.thinkingMode).toBeUndefined();
  });

  it("leaves thinkingMode undefined after toggling on and back off", async () => {
    const { onSubmit } = renderComposer();

    await toggleThinking();
    await toggleThinking();
    submitMessage("Changed my mind");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.thinkingMode).toBeUndefined();
  });
});

describe("SessionComposer — thinking mode on native models (stigmer/stigmer#1280)", () => {
  it("renders the thinking switch for a native model that declares a thinking form", async () => {
    renderComposer("claude-sonnet-5", "native");

    fireEvent.click(screen.getByRole("button", { name: /Claude Sonnet 5/ }));
    const toggle = await screen.findByRole("switch", { name: "Thinking" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("carries thinkingMode 'enabled' for a native model after toggling", async () => {
    const { onSubmit } = renderComposer("claude-sonnet-5", "native");

    await toggleThinking(/Claude Sonnet 5/);
    submitMessage("Think this through");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBe("enabled");
  });

  it("shows a model that always thinks with the switch on and locked", async () => {
    renderComposer("claude-fable-5", "native");

    fireEvent.click(screen.getByRole("button", { name: /Claude Fable 5/ }));
    const toggle = await screen.findByRole("switch", { name: "Thinking" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits 'enabled' for a model that always thinks, never 'disabled'", async () => {
    const { onSubmit } = renderComposer("claude-fable-5", "native");

    submitMessage("Answer this");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBe("enabled");
  });
});
