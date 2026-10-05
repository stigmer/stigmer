/**
 * The composer on a conversation whose agent names run defaults for its
 * engine. The server resolves a message's settings from the message, then
 * the agent's defaults, so the composer must send only what the person
 * changed: an untouched send names no model, tier or thinking (a copy
 * would freeze the agent's default into the message as the person's
 * choice), while the picker still shows what will run ("Agent default").
 *
 * Pins: the "Agent default: <model>" label and the agent's tier and
 * thinking as the switches' state; nothing sent untouched; an explicit
 * off sent alone; a picked model replacing the default and keeping the
 * switches' shown state as explicit choices.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import type { AgentRunDefaults } from "../../agent/run-defaults";
import { SessionComposer } from "../SessionComposer";

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
  shortDescription: "Balanced Claude",
  speedTier: "balanced",
  costTier: "standard",
  harness: "native",
  featured: true,
  serviceTiers: ["fast"],
  thinkingCapable: true,
};

const HAIKU: ModelInfo = {
  modelId: "claude-haiku-4-5",
  provider: "anthropic",
  displayName: "Haiku 4.5",
  shortDescription: "Fast Claude",
  speedTier: "fast",
  costTier: "economy",
  harness: "native",
  featured: true,
  serviceTiers: [],
  thinkingCapable: true,
};

const AGENT_DEFAULTS: AgentRunDefaults = {
  modelName: "claude-sonnet-4-6",
  thinkingMode: "enabled",
};

function createWrapper() {
  const client = {
    agentExecution: { uploadAttachment: vi.fn() },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{ models: [HAIKU, SONNET], isLoading: false, error: null, refetch: vi.fn() }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function renderComposer(props: { defaultModelId?: string; agentRunDefaults?: AgentRunDefaults } = {}) {
  const onSubmit = vi.fn();
  render(
    <SessionComposer
      onSubmit={onSubmit}
      harness="native"
      agentRunDefaults={AGENT_DEFAULTS}
      {...props}
    />,
    { wrapper: createWrapper() },
  );
  return { onSubmit };
}

function submitMessage(message: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
}

async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /Agent default: Sonnet 4\.6/ }));
  return screen.findByRole("switch", { name: "Thinking" });
}

afterEach(cleanup);

describe("SessionComposer — the agent's run defaults", () => {
  it("names the agent's model and shows its thinking as the switch state", async () => {
    renderComposer();

    const thinking = await openPicker();
    expect(thinking.getAttribute("aria-checked")).toBe("true");
    expect((await screen.findByRole("switch", { name: "Fast tier" })).getAttribute("aria-checked")).toBe("false");
  });

  it("sends no model, tier or thinking while untouched", async () => {
    const { onSubmit } = renderComposer();

    submitMessage("Use what the agent says");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.serviceTier).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
  });

  it("sends an explicit thinking off alone, adjusting the agent's model", async () => {
    const { onSubmit } = renderComposer();

    fireEvent.click(await openPicker());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    submitMessage("No thinking this time");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBe("disabled");
  });

  it("a picked model replaces the default and keeps the shown thinking as a choice", async () => {
    const { onSubmit } = renderComposer();

    await openPicker();
    fireEvent.click(await screen.findByRole("option", { name: /Haiku 4\.5/ }));
    submitMessage("On Haiku");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-haiku-4-5");
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBe("enabled");
  });

  it("a conversation's own last pick wins over the agent's default", async () => {
    const { onSubmit } = renderComposer({ defaultModelId: "claude-haiku-4-5" });

    expect(screen.queryByRole("button", { name: /Agent default/ })).toBeNull();
    submitMessage("Still Haiku");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-haiku-4-5");
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
  });
});
