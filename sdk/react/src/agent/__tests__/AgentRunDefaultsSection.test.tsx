/**
 * The agent detail view's "Run defaults" section. A save writes the
 * engine and the run settings together (the server judges the model
 * against the engine), keeps the API-only bounds it does not edit, and
 * shows the server's refusal where the edit was made.
 *
 * Pins: the read view; one save carrying harness and run_config with the
 * tool bounds intact; switching the engine dropping the model; "No
 * engine" clearing both; "Choose an engine" starting an agent with no
 * engine on native; speed and thinking offered only once a model is
 * picked; Cancel leaving the edit unsaved; the refusal message shown.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import { AgentRunDefaultsSection } from "../AgentRunDefaultsSection";

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

const SONNET: ModelInfo = {
  modelId: "claude-sonnet-4-6",
  provider: "anthropic",
  displayName: "Sonnet 4.6",
  shortDescription: "",
  speedTier: "balanced",
  costTier: "standard",
  harness: "native",
  featured: true,
  serviceTiers: ["fast"],
  thinkingCapable: true,
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ModelRegistryContext.Provider
      value={{ models: [SONNET], isLoading: false, error: null, refetch: vi.fn() }}
    >
      {children}
    </ModelRegistryContext.Provider>
  );
}

const SPEC = create(AgentSpecSchema, {
  harness: Harness.NATIVE,
  runConfig: {
    modelName: "claude-sonnet-4-6",
    serviceTier: ServiceTier.FAST,
    thinkingMode: ThinkingMode.ENABLED,
    maxCostUsd: 2,
    maxToolRounds: 12,
    maxToolResultChars: 20000,
  },
});

afterEach(cleanup);

describe("AgentRunDefaultsSection", () => {
  it("reads the engine, model, its tier and thinking, and the bounds", () => {
    render(
      <AgentRunDefaultsSection spec={SPEC} editable={false} isSaving={false} onSave={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("Sonnet 4.6")).toBeTruthy();
    expect(screen.getByText("Fast")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.getByText("$2 per message")).toBeTruthy();
    expect(screen.getByText("At most 12 per message")).toBeTruthy();
  });

  it("renders nothing read-only for an agent with no run defaults", () => {
    const { container } = render(
      <AgentRunDefaultsSection
        spec={create(AgentSpecSchema, {})}
        editable={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(container.textContent).toBe("");
  });

  it("saves harness and run_config together, keeping the API-only bounds", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <AgentRunDefaultsSection spec={SPEC} editable isSaving={false} onSave={onSave} />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.change(screen.getByPlaceholderText("No cap"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual({
      harness: Harness.NATIVE,
      runConfig: {
        modelName: "claude-sonnet-4-6",
        serviceTier: ServiceTier.FAST,
        thinkingMode: ThinkingMode.ENABLED,
        maxCostUsd: 1.5,
        maxToolRounds: 12,
        maxToolResultChars: 20000,
      },
    });
  });

  it("drops the model, tier and thinking when the engine changes", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <AgentRunDefaultsSection spec={SPEC} editable isSaving={false} onSave={onSave} />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual({
      harness: Harness.CURSOR,
      runConfig: { maxCostUsd: 2, maxToolRounds: 12, maxToolResultChars: 20000 },
    });
  });

  it("clears the engine and model together with No engine", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <AgentRunDefaultsSection
        spec={create(AgentSpecSchema, {
          harness: Harness.NATIVE,
          runConfig: { modelName: "claude-sonnet-4-6" },
        })}
        editable
        isSaving={false}
        onSave={onSave}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "No engine" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual({ harness: undefined, runConfig: undefined });
  });

  it("starts an agent with no engine on native when an engine is chosen", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <AgentRunDefaultsSection
        spec={create(AgentSpecSchema, {})}
        editable
        isSaving={false}
        onSave={onSave}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose an engine" }));
    expect(screen.getByRole("button", { name: "No engine" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual({ harness: Harness.NATIVE, runConfig: undefined });
  });

  it("offers speed and thinking only once a model is picked", () => {
    const { unmount } = render(
      <AgentRunDefaultsSection
        spec={create(AgentSpecSchema, { harness: Harness.NATIVE })}
        editable
        isSaving={false}
        onSave={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("switch", { name: "Fast tier" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Thinking" })).toBeNull();
    unmount();

    render(
      <AgentRunDefaultsSection spec={SPEC} editable isSaving={false} onSave={vi.fn()} />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("switch", { name: "Fast tier" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Thinking" })).toBeTruthy();
  });

  it("Cancel returns to the read view without saving", () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <AgentRunDefaultsSection spec={SPEC} editable isSaving={false} onSave={onSave} />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    fireEvent.change(screen.getByPlaceholderText("No cap"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("$2 per message")).toBeTruthy();
  });

  it("shows the server's refusal under the section", () => {
    render(
      <AgentRunDefaultsSection
        spec={SPEC}
        editable
        isSaving={false}
        error="model claude-sonnet-4-6 is not listed for the cursor engine"
        onSave={vi.fn().mockResolvedValue(false)}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit run defaults" }));
    expect(screen.getByRole("alert").textContent).toMatch(/not listed for the cursor engine/);
  });
});
