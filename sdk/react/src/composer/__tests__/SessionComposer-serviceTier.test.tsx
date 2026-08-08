import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import { SessionComposer } from "../SessionComposer";

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
 * End-to-end composer wiring for the service tier (stigmer/stigmer#357):
 * the toolbar's ModelSelector toggle must reach composer state, and an
 * active fast selection must ride the submit context to execution create.
 * This seam (SessionComposer → ComposerToolbar props → submit context) is
 * exactly where the feature can silently die while every layer on either
 * side unit-tests green.
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
            models: [FAST_CAPABLE],
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

function renderComposer() {
  const client = createMinimalStigmerMock();
  const onSubmit = vi.fn();

  const result = render(
    <SessionComposer
      onSubmit={onSubmit}
      harness="cursor"
      defaultModelId="composer-2.5"
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
 * jsdom — the switch is awaited) and flip the fast-tier switch in the
 * options area, then close the popover (toggling keeps it open).
 */
async function toggleFastTier() {
  fireEvent.click(screen.getByRole("button", { name: /Composer 2\.5/ }));
  const toggle = await screen.findByRole("switch", { name: "Fast tier" });
  fireEvent.click(toggle);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

afterEach(cleanup);

describe("SessionComposer — service tier submit contract", () => {
  it("renders the tier switch through the toolbar for a fast-capable model", async () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: /Composer 2\.5/ }));
    expect(await screen.findByRole("switch", { name: "Fast tier" })).toBeTruthy();
  });

  it("carries serviceTier 'fast' on the submit context after toggling", async () => {
    const { onSubmit } = renderComposer();

    await toggleFastTier();
    submitMessage("Run it fast");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.serviceTier).toBe("fast");
  });

  it("leaves serviceTier undefined when the switch is untouched", async () => {
    const { onSubmit } = renderComposer();

    submitMessage("Run it normally");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.serviceTier).toBeUndefined();
  });

  it("leaves serviceTier undefined after toggling fast on and back off", async () => {
    const { onSubmit } = renderComposer();

    await toggleFastTier();
    await toggleFastTier();
    submitMessage("Changed my mind");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.serviceTier).toBeUndefined();
  });
});
