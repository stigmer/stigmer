import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// The focus-refetch test broadcasts window events, which reach EVERY
// still-mounted hook in this file — including earlier tests' hooks whose
// one-shot mock chains are exhausted. Unmount between tests so a window
// broadcast only ever exercises the test that sent it.
afterEach(cleanup);
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelConversationListFilter,
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
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

function conversationAt(
  channelId: string,
  key: string,
  lastActivity: string,
  overrides?: { control?: ConversationControl; displayName?: string },
) {
  return create(ChannelConversationSchema, {
    agentChannelId: channelId,
    conversationKey: key,
    org: "acme",
    control: overrides?.control ?? ConversationControl.control_agent,
    displayName: overrides?.displayName ?? "",
    lastActivityAt: timestampFromDate(new Date(lastActivity)),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

  it("passes the predicate filter through and drops accumulated pages when it changes", async () => {
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
      ({ filter }: { filter: ChannelConversationListFilter }) =>
        useConversationList({ org: "acme", filter, ...NO_POLL }),
      {
        wrapper: wrapper(createMockStigmer(listConversations)),
        initialProps: {
          filter:
            ChannelConversationListFilter.channel_conversation_list_filter_unspecified,
        },
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    rerender({ filter: ChannelConversationListFilter.filter_wants_human });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filter: ChannelConversationListFilter.filter_wants_human,
      }),
    );
    // Page 2 of "all" is not page 2 of "wants human".
    expect(result.current.conversations).toEqual([]);
  });

  it("refetches the head when the window regains focus (DD-012: refocus is fresh)", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValue({ items: [], totalCount: 0 });
    renderHook(() => useConversationList({ org: "acme", ...NO_POLL }), {
      wrapper: wrapper(createMockStigmer(listConversations)),
    });
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
  });
});

describe("useConversationList.applyServerState (DD-012 D-a: own actions reflect immediately)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("overrides a listed row immediately and starts the retiring head fetch", async () => {
    const agentHeld = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z");
    const humanHeld = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z", {
      control: ConversationControl.control_human,
    });
    const postApply = deferred<{ items: unknown[]; totalCount: number }>();
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [agentHeld], totalCount: 1 })
      .mockReturnValueOnce(postApply.promise);

    const { result } = renderHook(
      () => useConversationList({ org: "acme", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversations[0].control).toBe(
      ConversationControl.control_agent,
    );

    act(() => result.current.applyServerState(humanHeld));

    // Immediate — no timers, no resolved fetch.
    expect(result.current.conversations[0].control).toBe(
      ConversationControl.control_human,
    );
    // The retiring round-trip started.
    expect(listConversations).toHaveBeenCalledTimes(2);
  });

  it("a pre-apply head answer resolving after the apply never revives pre-command state; the post-apply answer retires the overlay", async () => {
    const staleAgent = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z", {
      displayName: "Pat",
    });
    const freshHuman = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z", {
      control: ConversationControl.control_human,
      displayName: "Pat",
    });
    // The post-apply server read carries a marker so retiring is observable.
    const serverTruth = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z", {
      control: ConversationControl.control_human,
      displayName: "Pat (server truth)",
    });
    const stale = deferred<{ items: unknown[]; totalCount: number }>();
    const postApply = deferred<{ items: unknown[]; totalCount: number }>();
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [staleAgent], totalCount: 1 })
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(postApply.promise);

    const { result } = renderHook(
      () => useConversationList({ org: "acme", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A background head refresh is in flight (started BEFORE the command).
    act(() => result.current.refetch());

    // The command answers while that stale answer is still queued: resolve
    // the stale fetch FIRST, then apply from an async (non-discrete)
    // context — the microtask interleaving applyServerState sees in
    // production, where it is called from a command's promise chain.
    await act(async () => {
      stale.resolve({ items: [staleAgent], totalCount: 1 });
      result.current.applyServerState(freshHuman);
      await Promise.resolve();
    });

    // Whatever the interleaving did, the rendered row is the command's.
    expect(result.current.conversations[0].control).toBe(
      ConversationControl.control_human,
    );

    // The post-apply fetch answers: server truth is adopted, overlay gone.
    await act(async () => {
      postApply.resolve({ items: [serverTruth], totalCount: 1 });
    });
    await waitFor(() =>
      expect(result.current.conversations[0].displayName).toBe("Pat (server truth)"),
    );
    expect(result.current.conversations[0].control).toBe(
      ConversationControl.control_human,
    );
  });

  it("sorted-inserts an unlisted row by activity, never at the head (G-2: a command answer is not a recency claim)", async () => {
    const newest = conversationAt("ach_1", "15550001111", "2026-08-07T12:00:00Z");
    const oldest = conversationAt("ach_1", "15550003333", "2026-08-07T10:00:00Z");
    const middle = conversationAt("ach_1", "15550002222", "2026-08-07T11:00:00Z", {
      control: ConversationControl.control_human,
    });
    const postApply = deferred<{ items: unknown[]; totalCount: number }>();
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [newest, oldest], totalCount: 3 })
      .mockReturnValueOnce(postApply.promise);

    const { result } = renderHook(
      () => useConversationList({ org: "acme", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.applyServerState(middle));

    expect(result.current.conversations.map((c) => c.conversationKey)).toEqual([
      "15550001111",
      "15550002222",
      "15550003333",
    ]);
  });

  it("never inserts a foreign-channel row into a channel-scoped list", async () => {
    const listed = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z");
    const foreign = conversationAt("ach_2", "15550009999", "2026-08-07T12:00:00Z", {
      control: ConversationControl.control_human,
    });
    const postApply = deferred<{ items: unknown[]; totalCount: number }>();
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [listed], totalCount: 1 })
      .mockReturnValueOnce(postApply.promise);

    const { result } = renderHook(
      () =>
        useConversationList({ org: "acme", agentChannelId: "ach_1", ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.applyServerState(foreign));

    expect(result.current.conversations.map((c) => c.conversationKey)).toEqual([
      "15550001111",
    ]);
  });

  it("is update-only under a server-evaluated predicate filter (membership is the server's claim to make)", async () => {
    const listed = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z");
    const listedFresh = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z", {
      control: ConversationControl.control_human,
    });
    const unlisted = conversationAt("ach_1", "15550002222", "2026-08-07T12:00:00Z", {
      control: ConversationControl.control_human,
    });
    const postApply = deferred<{ items: unknown[]; totalCount: number }>();
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [listed], totalCount: 1 })
      .mockReturnValue(postApply.promise);

    const { result } = renderHook(
      () =>
        useConversationList({
          org: "acme",
          filter: ChannelConversationListFilter.filter_wants_human,
          ...NO_POLL,
        }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Absent row: never inserted under the filter.
    act(() => result.current.applyServerState(unlisted));
    expect(result.current.conversations.map((c) => c.conversationKey)).toEqual([
      "15550001111",
    ]);

    // Listed row: updated in place — always honest.
    act(() => result.current.applyServerState(listedFresh));
    expect(result.current.conversations[0].control).toBe(
      ConversationControl.control_human,
    );
  });

  it("a stale in-flight loadMore page cannot overwrite an applied row", async () => {
    const staleAgent = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z");
    const freshHuman = conversationAt("ach_1", "15550001111", "2026-08-07T11:00:00Z", {
      control: ConversationControl.control_human,
    });
    const older = conversationAt("ach_1", "15550003333", "2026-08-07T09:00:00Z");
    const pageTwo = deferred<{ items: unknown[]; totalCount: number }>();
    const postApply = deferred<{ items: unknown[]; totalCount: number }>();
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [staleAgent], totalCount: 2 })
      .mockReturnValueOnce(pageTwo.promise)
      .mockReturnValueOnce(postApply.promise);

    const { result } = renderHook(
      () => useConversationList({ org: "acme", pageSize: 1, ...NO_POLL }),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Page 2 (carrying a stale copy of the applied row) is in flight when
    // the command answers.
    act(() => result.current.loadMore());
    act(() => result.current.applyServerState(freshHuman));

    await act(async () => {
      pageTwo.resolve({ items: [staleAgent, older], totalCount: 2 });
    });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    const byKey = new Map(
      result.current.conversations.map((c) => [c.conversationKey, c]),
    );
    expect(byKey.get("15550001111")?.control).toBe(ConversationControl.control_human);
    expect(byKey.has("15550003333")).toBe(true);
    expect(result.current.conversations).toHaveLength(2);
  });
});
