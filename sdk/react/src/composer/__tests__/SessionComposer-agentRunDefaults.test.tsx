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
 * switches' shown state (the agent's thinking, and its fast tier on a
 * model that runs one) as explicit choices; an "Agent default" entry in
 * the picker as the way back from a pick; every pick dropped when the
 * agent changes; a tier or thinking pick made before the agent's
 * defaults arrive dropped when they do; a picked model dropped when the
 * engine changes under it
 * to one that does not list it (the unified lookup would otherwise send
 * it with an engine that does not run it), kept where the new engine
 * lists it, and the host's seed followed where nothing was picked.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import type { ResourceRef } from "@stigmer/sdk";
import type { AgentRunDefaults } from "../../agent/run-defaults";
import type { HarnessOption } from "../../models/harness";
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

const OPUS: ModelInfo = {
  modelId: "claude-opus-4-1",
  provider: "anthropic",
  displayName: "Opus 4.1",
  shortDescription: "Deep Claude",
  speedTier: "slow",
  costTier: "premium",
  harness: "native",
  featured: true,
  serviceTiers: ["fast"],
  thinkingCapable: true,
};

const COMPOSER: ModelInfo = {
  modelId: "composer-2.5",
  provider: "cursor",
  displayName: "Composer 2.5",
  shortDescription: "Cursor's own model",
  speedTier: "fastest",
  costTier: "economy",
  harness: "cursor",
  featured: true,
  serviceTiers: [],
};

// The same model id listed on the other engine as well.
const SONNET_ON_CURSOR: ModelInfo = { ...SONNET, harness: "cursor", displayName: "Sonnet 4.6 (Cursor)", featured: false };

const AGENT_DEFAULTS: AgentRunDefaults = {
  modelName: "claude-sonnet-4-6",
  thinkingMode: "enabled",
};

function createWrapper() {
  const client = {
    run: { uploadAttachment: vi.fn() },
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
          value={{ models: [HAIKU, SONNET, OPUS, COMPOSER, SONNET_ON_CURSOR], isLoading: false, error: null, refetch: vi.fn() }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

type ComposerProps = {
  defaultModelId?: string;
  agentRunDefaults?: AgentRunDefaults;
  agentRef?: ResourceRef | null;
  harness?: HarnessOption;
  onModelPickCleared?: () => void;
};

function renderComposer(props: ComposerProps = {}) {
  const onSubmit = vi.fn();
  const wrapper = createWrapper();
  const element = (p: ComposerProps) => (
    <SessionComposer
      onSubmit={onSubmit}
      harness="native"
      agentRunDefaults={AGENT_DEFAULTS}
      {...p}
    />
  );
  const { rerender } = render(element(props), { wrapper });
  return { onSubmit, rerender: (next: ComposerProps) => rerender(element(next)) };
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

  it("a picked model keeps the agent's fast tier as a choice when it runs one", async () => {
    const { onSubmit } = renderComposer({
      agentRunDefaults: { modelName: "claude-sonnet-4-6", serviceTier: "fast" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Agent default: Sonnet 4\.6/ }));
    expect((await screen.findByRole("switch", { name: "Fast tier" })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(await screen.findByRole("option", { name: /Opus 4\.1/ }));
    submitMessage("On Opus, still fast");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-opus-4-1");
    expect(onSubmit.mock.calls[0][2]?.serviceTier).toBe("fast");
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
  });

  it("a conversation's own last pick wins over the agent's default", async () => {
    const { onSubmit } = renderComposer({ defaultModelId: "claude-haiku-4-5" });

    expect(screen.queryByRole("button", { name: /Agent default/ })).toBeNull();
    submitMessage("Still Haiku");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-haiku-4-5");
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
  });

  it("lists the agent's default as the way back from a picked model", async () => {
    const onModelPickCleared = vi.fn();
    const { onSubmit } = renderComposer({ onModelPickCleared });

    // Pick Haiku and turn thinking off for it...
    fireEvent.click(await openPicker());
    fireEvent.click(await screen.findByRole("option", { name: /Haiku 4\.5/ }));
    fireEvent.click(screen.getByRole("button", { name: /Haiku 4\.5/ }));
    fireEvent.click(await screen.findByRole("switch", { name: "Thinking" }));

    // ...then choose the agent's default back.
    fireEvent.click(await screen.findByRole("option", { name: "Agent default: Sonnet 4.6" }));
    expect(onModelPickCleared).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Agent default: Sonnet 4\.6/ })).toBeTruthy();
    submitMessage("Back to the agent's choice");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.serviceTier).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
  });

  it("checks the agent's default entry, not its model's row, while it applies", async () => {
    renderComposer();

    await openPicker();
    const entry = await screen.findByRole("option", { name: "Agent default: Sonnet 4.6" });
    expect(entry.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: /^Sonnet 4\.6/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("drops the person's picks when the conversation's agent changes", async () => {
    const { onSubmit, rerender } = renderComposer({ agentRef: { org: "acme", slug: "a" } });

    // Thinking turned off, and a model picked, for agent A...
    fireEvent.click(await openPicker());
    fireEvent.click(await screen.findByRole("option", { name: /Opus 4\.1/ }));

    // ...do not follow the person to agent B.
    rerender({
      agentRef: { org: "acme", slug: "b" },
      agentRunDefaults: { modelName: "claude-haiku-4-5" },
    });
    expect(await screen.findByRole("button", { name: /Agent default: Haiku 4\.5/ })).toBeTruthy();
    submitMessage("Agent B's way");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.serviceTier).toBeUndefined();
  });

  it("drops a thinking pick made before the agent's defaults arrive", async () => {
    const { onSubmit, rerender } = renderComposer({
      agentRef: { org: "acme", slug: "a" },
      agentRunDefaults: undefined,
      defaultModelId: "claude-sonnet-4-6",
    });

    // Thinking turned on for the model shown while the agent loads...
    fireEvent.click(screen.getByRole("button", { name: /Sonnet 4\.6/ }));
    fireEvent.click(await screen.findByRole("switch", { name: "Thinking" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    // ...is not sent onto the agent's own model once its defaults arrive
    // (the host then seeds no model: the agent's default applies).
    rerender({
      agentRef: { org: "acme", slug: "a" },
      agentRunDefaults: { modelName: "claude-haiku-4-5" },
      defaultModelId: undefined,
    });
    expect(await screen.findByRole("button", { name: /Agent default: Haiku 4\.5/ })).toBeTruthy();
    submitMessage("The agent's way");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]?.thinkingMode).toBeUndefined();
    expect(onSubmit.mock.calls[0][2]?.serviceTier).toBeUndefined();
  });

  it("drops a picked model the new engine does not list when the engine changes under it", async () => {
    const { onSubmit, rerender } = renderComposer({ agentRunDefaults: undefined });

    fireEvent.click(screen.getByRole("button", { name: /Sonnet 4\.6|Haiku 4\.5|Opus 4\.1/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Haiku 4\.5/ }));

    // The agent's engine arrives after the pick: cursor, with its model.
    rerender({ harness: "cursor", agentRunDefaults: { modelName: "composer-2.5" } });
    expect(await screen.findByRole("button", { name: /Agent default: Composer 2\.5/ })).toBeTruthy();
    submitMessage("On the agent's engine");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
  });

  it("falls back to the new engine's default when no agent model applies", async () => {
    const { onSubmit, rerender } = renderComposer({ agentRunDefaults: undefined });

    fireEvent.click(screen.getByRole("button", { name: /Sonnet 4\.6|Haiku 4\.5|Opus 4\.1/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Haiku 4\.5/ }));

    rerender({ harness: "cursor", agentRunDefaults: undefined });
    submitMessage("On the new engine");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("composer-2.5");
  });

  it("keeps a picked model the new engine lists too", async () => {
    const { onSubmit, rerender } = renderComposer({ agentRunDefaults: undefined });

    fireEvent.click(screen.getByRole("button", { name: /Sonnet 4\.6|Haiku 4\.5|Opus 4\.1/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^Sonnet 4\.6/ }));
    rerender({ harness: "cursor", agentRunDefaults: undefined });
    submitMessage("Sonnet on either engine");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("claude-sonnet-4-6");
  });

  it("follows the host's seed through an engine change when nothing was picked", async () => {
    const { onSubmit, rerender } = renderComposer({
      agentRunDefaults: undefined,
      defaultModelId: "claude-haiku-4-5",
    });

    rerender({ harness: "cursor", agentRunDefaults: undefined, defaultModelId: "composer-2.5" });
    submitMessage("The host's model for the new engine");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1]).toBe("composer-2.5");
  });
});
