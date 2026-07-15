import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GetAgentChannelsByAgentRequest } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentChannelList } from "../useAgentChannelList";

function createMockStigmer(overrides: {
  getByAgent?: (input: GetAgentChannelsByAgentRequest) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      getByAgent:
        overrides.getByAgent ??
        vi.fn().mockResolvedValue({ totalCount: 0, items: [] }),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function makeChannel(org: string, slug: string, id = `ach_${org}_${slug}`) {
  return {
    metadata: { id, org, slug },
    spec: { enabled: true },
    status: { installState: 2 },
  };
}

describe("useAgentChannelList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the agent's channels by agent id", async () => {
    const channel = makeChannel("acme", "support-agent-slack");
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 1, items: [channel] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.channels).toEqual([channel]);
    expect(result.current.error).toBeNull();
    expect(getByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "" }),
    );
  });

  it("threads the org scope into the request", async () => {
    // The org scope belongs in the RPC, never client-side filtering: the
    // server narrows a multi-org member's view to one org's channels.
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 0, items: [] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(
      () => useAgentChannelList("agt_1", "acme"),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "acme" }),
    );
  });

  it("refetches when the org scope changes", async () => {
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 0, items: [] });
    const client = createMockStigmer({ getByAgent });

    const { result, rerender } = renderHook(
      ({ org }: { org: string }) => useAgentChannelList("agt_1", org),
      { wrapper: wrapper(client), initialProps: { org: "acme" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getByAgent).toHaveBeenCalledTimes(1);

    rerender({ org: "consumer-org" });
    await waitFor(() => expect(getByAgent).toHaveBeenCalledTimes(2));
    expect(getByAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "consumer-org" }),
    );
  });

  it("resolves empty (no channels yet) when the agent has no channels", async () => {
    const client = createMockStigmer();

    const { result } = renderHook(() => useAgentChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The no-channel state is not an error: connecting the first channel
    // is the empty state's call to action.
    expect(result.current.channels).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("skips fetching while the agent id is empty (stable no-op)", () => {
    const getByAgent = vi.fn();
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentChannelList(""), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.channels).toEqual([]);
    expect(getByAgent).not.toHaveBeenCalled();
  });

  it("exposes fetch failures as errors", async () => {
    const getByAgent = vi
      .fn()
      .mockRejectedValue(new Error("backend unavailable"));
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.channels).toEqual([]);
  });

  it("refetches on demand", async () => {
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 0, items: [] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getByAgent).toHaveBeenCalledTimes(1);

    result.current.refetch();
    await waitFor(() => expect(getByAgent).toHaveBeenCalledTimes(2));
  });
});
