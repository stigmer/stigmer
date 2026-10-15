import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useSaveAgentChannel } from "../useSaveAgentChannel";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";

function createMockStigmer(overrides: {
  apply?: (input: AgentChannelInput) => Promise<unknown>;
  update?: (resource: AgentChannel, paths: string[]) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
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

  it("updates a channel naming only the patch's fields, on its id and the etag it was loaded at", async () => {
    const update = vi.fn().mockResolvedValue(makeChannel());
    const client = createMockStigmer({ update });

    const { result } = renderHook(() => useSaveAgentChannel(), {
      wrapper: wrapper(client),
    });

    const boundChannel = makeChannel({
      metadata: { id: "ach_1", name: "Support Slack", slug: "support-slack", org: "acme", labels: {}, etag: "etag-at-load" },
      spec: {
        agentRef: { org: "acme", slug: "support-agent" },
        enabled: true,
        providerConfig: { case: "slack", value: {} },
        appRef: { org: "acme", slug: "acme-support-app" },
        vaults: [{ org: "acme", slug: "github-credentials" }],
      },
    });

    await act(async () => {
      await result.current.update(boundChannel, { enabled: false });
    });

    // The disable toggle names `spec.enabled` alone: the agent reference,
    // the provider marker, the serving-app binding and the bound
    // credentials keep their stored values without being sent back.
    const sent = sentUpdate<AgentChannel>(update);
    expect(sent.paths).toEqual(["spec.enabled"]);
    expect(sent.id).toBe("ach_1");
    expect(sent.etag).toBe("etag-at-load");
    expect(sent.resource.spec?.enabled).toBe(false);
  });

  it("names a key set to undefined, which clears that field", async () => {
    const update = vi.fn().mockResolvedValue(makeChannel());
    const client = createMockStigmer({ update });
    const { result } = renderHook(() => useSaveAgentChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.update(makeChannel(), {
        runConfig: undefined,
        vaults: [{ org: "acme", slug: "github-credentials" }],
      });
    });

    const sent = sentUpdate<AgentChannel>(update);
    expect(sent.paths).toEqual(["spec.run_config", "spec.vaults"]);
    expect(sent.resource.spec?.runConfig).toBeUndefined();
    expect(sentRefs(sent.resource.spec?.vaults)).toEqual([{ org: "acme", slug: "github-credentials" }]);
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
