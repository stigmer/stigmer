import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import { ChannelRunConfigDialog } from "../ChannelRunConfigDialog";

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
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

/**
 * The console's first run_config editor (stigmer/stigmer#792). The pinned
 * behaviors are the edit-surface contracts the rest of the platform relies
 * on: `max_tool_rounds` (the operator knob this editor never renders)
 * survives every save verbatim, an all-empty draft clears the block
 * ("empty = inherit"), and untouched variant switches stay off the wire
 * (the #357/#772 unspecified-vs-explicit ledger distinction).
 */

const MODELS: ModelInfo[] = [
  {
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
  },
];

function makeChannel(runConfig?: {
  modelName?: string;
  maxCostUsd?: number;
  maxToolRounds?: number;
  serviceTier?: ServiceTier;
  thinkingMode?: ThinkingMode;
}) {
  return {
    metadata: {
      id: "ach_1",
      name: "Support Slack",
      slug: "support-slack",
      org: "acme",
      labels: {},
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      providerConfig: { case: "slack", value: {} },
      environmentRefs: [],
      ...(runConfig
        ? {
            runConfig: {
              modelName: runConfig.modelName ?? "",
              maxCostUsd: runConfig.maxCostUsd ?? 0,
              maxToolRounds: runConfig.maxToolRounds ?? 0,
              serviceTier: runConfig.serviceTier ?? ServiceTier.UNSPECIFIED,
              thinkingMode: runConfig.thinkingMode ?? ThinkingMode.UNSPECIFIED,
            },
          }
        : {}),
    },
    status: { installState: 2 },
  } as never;
}

function createMockStigmer() {
  const apply = vi.fn().mockResolvedValue({});
  const client = { agentChannel: { apply } } as never;
  return { client, apply };
}

function Providers({
  client,
  children,
}: {
  client: unknown;
  children: ReactNode;
}) {
  return (
    <StigmerContext.Provider value={client as never}>
      <ModelRegistryContext.Provider
        value={{ models: MODELS, isLoading: false, error: null, refetch: vi.fn() }}
      >
        {children}
      </ModelRegistryContext.Provider>
    </StigmerContext.Provider>
  );
}

function renderDialog(channel: unknown) {
  const { client, apply } = createMockStigmer();
  const onSaved = vi.fn();
  render(
    <Providers client={client}>
      <ChannelRunConfigDialog
        open
        onOpenChange={vi.fn()}
        channel={channel as never}
        onSaved={onSaved}
      />
    </Providers>,
  );
  return { apply, onSaved };
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("ChannelRunConfigDialog", () => {
  it("preserves max_tool_rounds verbatim even though it never renders", async () => {
    const { apply } = renderDialog(
      makeChannel({ modelName: "claude-haiku-4-5", maxToolRounds: 25 }),
    );

    expect(screen.queryByText(/tool round/i)).toBeNull();
    await save();

    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    const input = apply.mock.calls[0][0] as AgentChannelInput;
    expect(input.runConfig?.maxToolRounds).toBe(25);
    expect(input.runConfig?.modelName).toBe("claude-haiku-4-5");
  });

  it("clears run_config entirely when the draft is emptied (empty = inherit)", async () => {
    const { apply } = renderDialog(
      makeChannel({ modelName: "claude-haiku-4-5", maxCostUsd: 2 }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset to platform default" }),
    );
    fireEvent.change(screen.getByLabelText(/Budget per run/), {
      target: { value: "" },
    });
    await save();

    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    const input = apply.mock.calls[0][0] as AgentChannelInput;
    expect(input.runConfig).toBeUndefined();
  });

  it("carries an actively enabled thinking mode, and only then", async () => {
    const { apply } = renderDialog(makeChannel({ modelName: "claude-haiku-4-5" }));

    fireEvent.click(screen.getByRole("button", { name: /Haiku 4\.5/ }));
    fireEvent.click(await screen.findByRole("switch", { name: "Thinking" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await save();

    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    const input = apply.mock.calls[0][0] as AgentChannelInput;
    expect(input.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
    // The untouched tier stays absent — never stamped as an explicit
    // STANDARD by a save (#357 ledger distinction).
    expect(input.runConfig?.serviceTier).toBeUndefined();
  });

  it("round-trips a stored thinking pin into the switch state", async () => {
    renderDialog(
      makeChannel({
        modelName: "claude-haiku-4-5",
        thinkingMode: ThinkingMode.ENABLED,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Haiku 4\.5/ }));
    const toggle = await screen.findByRole("switch", { name: "Thinking" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("collects a budget without requiring a model pin", async () => {
    const { apply } = renderDialog(makeChannel());

    fireEvent.change(screen.getByLabelText(/Budget per run/), {
      target: { value: "1.5" },
    });
    await save();

    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    const input = apply.mock.calls[0][0] as AgentChannelInput;
    expect(input.runConfig?.maxCostUsd).toBe(1.5);
    expect(input.runConfig?.modelName).toBeUndefined();
  });
});
