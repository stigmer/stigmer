import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useSaveAgentChannel, agentChannelToInput } from "../useSaveAgentChannel";

function createMockStigmer(overrides: {
  apply?: (input: AgentChannelInput) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

function makeChannel(overrides: Record<string, unknown> = {}): AgentChannel {
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
    },
    status: { installState: 2 },
    ...overrides,
  } as never;
}

describe("agentChannelToInput", () => {
  it("reproduces an existing channel verbatim", () => {
    const input = agentChannelToInput(makeChannel());

    expect(input).toEqual({
      name: "Support Slack",
      slug: "support-slack",
      org: "acme",
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      slack: {},
    });
  });

  it("carries labels and omits empty optionals", () => {
    const channel = makeChannel({
      metadata: {
        id: "ach_1",
        name: "Support Slack",
        slug: "",
        org: "acme",
        labels: { team: "cx" },
      },
    });

    const input = agentChannelToInput(channel);
    expect(input.labels).toEqual({ team: "cx" });
    // An empty slug must be omitted, not sent as "" — apply would reject it.
    expect(input).not.toHaveProperty("slug");
  });

  it("omits the slack marker when the provider config is absent", () => {
    const channel = makeChannel({
      spec: {
        agentRef: { org: "acme", slug: "support-agent" },
        enabled: false,
        providerConfig: { case: undefined },
      },
    });

    const input = agentChannelToInput(channel);
    expect(input).not.toHaveProperty("slack");
    expect(input.enabled).toBe(false);
  });
});

describe("useSaveAgentChannel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("applies the input and returns the persisted channel", async () => {
    const persisted = makeChannel();
    const apply = vi.fn().mockResolvedValue(persisted);
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentChannel(), {
      wrapper: wrapper(client),
    });

    const input: AgentChannelInput = {
      name: "Support Slack",
      org: "acme",
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      slack: {},
    };

    let returned: AgentChannel | undefined;
    await act(async () => {
      returned = await result.current.save(input);
    });

    expect(apply).toHaveBeenCalledWith(input);
    expect(returned).toBe(persisted);
    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("supports the toggle idiom: full input with one field changed", async () => {
    const apply = vi.fn().mockResolvedValue(makeChannel());
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.save({
        ...agentChannelToInput(makeChannel()),
        enabled: false,
      });
    });

    // The disable toggle must preserve the rest of the spec — a partial
    // input would silently drop agentRef or the provider marker.
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Support Slack",
        agentRef: { org: "acme", slug: "support-agent" },
        slack: {},
        enabled: false,
      }),
    );
  });

  it("tracks isPending during the flight", async () => {
    let resolveApply: (value: unknown) => void = () => {};
    const apply = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveApply = resolve; }),
    );
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentChannel(), {
      wrapper: wrapper(client),
    });

    let savePromise: Promise<unknown> = Promise.resolve();
    act(() => {
      savePromise = result.current.save({
        name: "x",
        org: "acme",
        agentRef: { org: "acme", slug: "a" },
        slack: {},
      });
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      resolveApply({});
      await savePromise;
    });
    expect(result.current.isPending).toBe(false);
  });

  it("captures and rethrows save failures", async () => {
    const apply = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.save({
          name: "x",
          org: "acme",
          agentRef: { org: "acme", slug: "a" },
          slack: {},
        }),
      ).rejects.toThrow("quota exceeded");
    });

    expect(result.current.error?.message).toBe("quota exceeded");
    expect(result.current.isPending).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
