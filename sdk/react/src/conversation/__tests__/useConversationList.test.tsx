import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { ChannelConversationSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useConversationList } from "../useConversationList";

function conversation(channelId: string, key: string, displayName = "") {
  return create(ChannelConversationSchema, {
    agentChannelId: channelId,
    conversationKey: key,
    org: "acme",
    displayName,
  });
}

function createMockStigmer(listConversations: (input: unknown) => Promise<unknown>) {
  return { agentChannel: { listConversations } } as never;
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

const NO_POLL = { refetchIntervalMs: false as const };

describe("useConversationList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the org's head page with the exact server total", async () => {
    const listConversations = vi.fn().mockResolvedValue({
      items: [conversation("ach_1", "15550001111", "Pat")],
      totalCount: 12,
    });
    const { result } = renderHook(
      () => useConversationList({ org: "acme", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.totalCount).toBe(12);
    expect(result.current.hasMore).toBe(true);
    expect(listConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        agentChannelId: "",
        pageInfo: expect.objectContaining({ num: 1, size: 50 }),
      }),
    );
  });

  it("passes the channel filter through", async () => {
    const listConversations = vi.fn().mockResolvedValue({ items: [], totalCount: 0 });
    renderHook(
      () => useConversationList({ org: "acme", agentChannelId: "ach_9", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );

    await waitFor(() =>
      expect(listConversations).toHaveBeenCalledWith(
        expect.objectContaining({ agentChannelId: "ach_9" }),
      ),
    );
  });

  it("skips fetching without an org (stable no-op)", async () => {
    const listConversations = vi.fn();
    const { result } = renderHook(() => useConversationList({ org: null, ...NO_POLL }), {
      wrapper: wrapper(createMockStigmer(listConversations)),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listConversations).not.toHaveBeenCalled();
    expect(result.current.conversations).toEqual([]);
  });

  it("accumulates older pages and dedups a conversation that moved between pages", async () => {
    // Offset pages drift under live activity: 15550002222 sat on page 2
    // when it was fetched, then new activity moved it into the polled
    // head. It must render ONCE, in its head (fresher) position.
    const head = [
      conversation("ach_1", "15550002222", "Moved Up"),
      conversation("ach_1", "15550001111"),
    ];
    const pageTwo = [
      conversation("ach_1", "15550002222", "Stale Copy"),
      conversation("ach_1", "15550003333"),
    ];
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: head, totalCount: 4 })
      .mockResolvedValueOnce({ items: pageTwo, totalCount: 4 });

    const { result } = renderHook(
      () => useConversationList({ org: "acme", pageSize: 2, ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(listConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageInfo: expect.objectContaining({ num: 2, size: 2 }) }),
    );
    const keys = result.current.conversations.map((c) => c.conversationKey);
    expect(keys).toEqual(["15550002222", "15550001111", "15550003333"]);
    expect(result.current.conversations[0].displayName).toBe("Moved Up");
    // 3 loaded of a real total of 4.
    expect(result.current.hasMore).toBe(true);
  });

  it("records a loadMore failure without disturbing the loaded list", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({
        items: [conversation("ach_1", "15550001111")],
        totalCount: 5,
      })
      .mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(
      () => useConversationList({ org: "acme", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull());

    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("drops accumulated pages when the filter changes — page 2 of channel A is not page 2 of channel B", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({
        items: [conversation("ach_1", "15550001111")],
        totalCount: 3,
      })
      .mockResolvedValueOnce({
        items: [conversation("ach_1", "15550002222")],
        totalCount: 3,
      })
      .mockResolvedValue({ items: [], totalCount: 0 });

    const { result, rerender } = renderHook(
      ({ channel }: { channel: string }) =>
        useConversationList({ org: "acme", agentChannelId: channel, ...NO_POLL }),
      {
        wrapper: wrapper(createMockStigmer(listConversations)),
        initialProps: { channel: "ach_1" },
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    rerender({ channel: "ach_2" });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.conversations).toEqual([]);
    expect(result.current.totalCount).toBe(0);
  });
});
