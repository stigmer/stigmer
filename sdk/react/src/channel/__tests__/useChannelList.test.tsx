// useChannelList: an agent's channels of every type (chat links, Slack,
// WhatsApp), scoped to an organization in the request, every page walked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ListChannelsByAgentRequest } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useChannelList } from "../useChannelList";

function createMockStigmer(overrides: {
  listByAgent?: (input: ListChannelsByAgentRequest) => Promise<unknown>;
} = {}) {
  return {
    channel: {
      listByAgent:
        overrides.listByAgent ??
        vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
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

function makeChannel(org: string, slug: string, id = `chn_${org}_${slug}`) {
  return {
    metadata: { id, org, slug },
    spec: { enabled: true },
    status: { installState: 2 },
  };
}

describe("useChannelList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the agent's channels by agent id", async () => {
    const channel = makeChannel("acme", "support-agent-slack");
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [channel], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.channels).toEqual([channel]);
    expect(result.current.error).toBeNull();
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "" }),
    );
  });

  it("threads the org scope into the request", async () => {
    // The org scope belongs in the RPC, never client-side filtering: the
    // server narrows a multi-org member's view to one org's channels.
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(
      () => useChannelList("agt_1", "acme"),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "acme" }),
    );
  });

  it("refetches when the org scope changes", async () => {
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result, rerender } = renderHook(
      ({ org }: { org: string }) => useChannelList("agt_1", org),
      { wrapper: wrapper(client), initialProps: { org: "acme" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByAgent).toHaveBeenCalledTimes(1);

    rerender({ org: "consumer-org" });
    await waitFor(() => expect(listByAgent).toHaveBeenCalledTimes(2));
    expect(listByAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "consumer-org" }),
    );
  });

  it("returns every channel of every type — each surface filters by spec.type", async () => {
    // One list for the one kind: the Channels tab lists every type and
    // picks each channel's card by spec.type; the hook never filters.
    const chatLink = { ...makeChannel("acme", "support-agent-web"), spec: { enabled: true, type: { case: "web", value: {} } } };
    const slack = { ...makeChannel("acme", "support-agent-slack"), spec: { enabled: true, type: { case: "slack", value: {} } } };
    const whatsapp = { ...makeChannel("acme", "support-agent-whatsapp"), spec: { enabled: true, type: { case: "whatsapp", value: {} } } };
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [chatLink, slack, whatsapp], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.channels).toEqual([chatLink, slack, whatsapp]);
  });

  it("resolves empty (no channels yet) when the agent has no channels", async () => {
    const client = createMockStigmer();

    const { result } = renderHook(() => useChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The no-channel state is not an error: connecting the first channel
    // is the empty state's call to action.
    expect(result.current.channels).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("skips fetching while the agent id is empty (stable no-op)", () => {
    const listByAgent = vi.fn();
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useChannelList(""), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.channels).toEqual([]);
    expect(listByAgent).not.toHaveBeenCalled();
  });

  it("exposes fetch failures as errors", async () => {
    const listByAgent = vi
      .fn()
      .mockRejectedValue(new Error("backend unavailable"));
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.channels).toEqual([]);
  });

  it("refetches on demand", async () => {
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useChannelList("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByAgent).toHaveBeenCalledTimes(1);

    result.current.refetch();
    await waitFor(() => expect(listByAgent).toHaveBeenCalledTimes(2));
  });
});
