/**
 * Proves the harness label beside the model (../ComposerToolbar.tsx over
 * ../../models/ModelSelector.tsx): a composer that offers the harness (the
 * console's own, `audience="integrator"`) names it before the model, as
 * "Stigmer · Sonnet 4.6"; one that does not (an app's users,
 * `audience="endUser"`, and a guest) runs the harness it is given and names
 * none, so Stigmer's machinery never reaches people using a builder's
 * product. Which audience offers it is pinned in
 * ../../session/__tests__/audienceWiring.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ModelInfo } from "@stigmer/react-core";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { ComposerToolbar, type ComposerToolbarProps } from "../ComposerToolbar";

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

const SONNET: ModelInfo = {
  modelId: "claude-sonnet-4-6",
  provider: "anthropic",
  displayName: "Sonnet 4.6",
  shortDescription: "Fast agentic model",
  speedTier: "fastest",
  costTier: "economy",
  harness: "stigmer",
  featured: true,
  serviceTiers: [],
};

function renderToolbar(showHarnessSelector: boolean) {
  const props: ComposerToolbarProps = {
    disabled: false,
    isSubmitting: false,
    canSend: true,
    onSend: vi.fn(),
    showHarnessSelector,
    harness: "stigmer",
    onHarnessChange: vi.fn(),
    showInteractionModePicker: true,
    interactionMode: "agent",
    onInteractionModeChange: vi.fn(),
    showModelSelector: true,
    modelId: SONNET.modelId,
    onModelChange: vi.fn(),
    showWorkspace: false,
    workspaceCount: 0,
    workspaceContent: null,
    showAttach: false,
    fileCount: 0,
    onAttachClick: vi.fn(),
    configureItems: [],
    configOpen: false,
    onConfigOpenChange: vi.fn(),
    configActivePanel: null,
    onConfigActivePanelChange: vi.fn(),
    renderConfigPanel: () => null,
  };
  render(
    <ModelRegistryContext.Provider value={{ models: [SONNET], isLoading: false, error: null, refetch: vi.fn() }}>
      <ComposerToolbar {...props} />
    </ModelRegistryContext.Provider>,
  );
  return document.querySelector<HTMLElement>("[data-model-picker]")!;
}

describe("ComposerToolbar, the harness beside the model", () => {
  it("names the harness before the model where the composer offers it", () => {
    const picker = renderToolbar(true);
    expect(picker.textContent).toBe("Stigmer·Sonnet 4.6");
  });

  it("names no harness where the composer does not offer one, as for an app's users", () => {
    const picker = renderToolbar(false);
    expect(picker.textContent).toBe("Sonnet 4.6");
    expect(screen.queryByText("Stigmer")).toBeNull();
  });
});
