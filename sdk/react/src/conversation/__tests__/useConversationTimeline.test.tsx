import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ConversationTimelineItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useConversationTimeline } from "../useConversationTimeline";

function item(id: string, iso: string, overrides: Record<string, unknown> = {}) {
  return create(ConversationTimelineItemSchema, {
    itemId: id,
    at: timestampFromDate(new Date(iso)),
    text: `body of ${id}`,
    ...overrides,
  });
}

function createMockStigmer(getTimeline: (input: unknown) => Promise<unknown>) {
  return { agentChannel: { getTimeline } } as never;
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

describe("useConversationTimeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("serves the head page in chronological order — the server pages newest-first", async () => {
    const getTimeline = vi.fn().mockResolvedValue({
      items: [item("wa:3", "2026-08-07T09:02:00Z"), item("wa:1", "2026-08-07T09:00:00Z")],
      nextPageToken: "",
    });
    const { result } = renderHook(
      () => useConversationTimeline("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getTimeline)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items.map((i) => i.itemId)).toEqual(["wa:1", "wa:3"]);
    expect(result.current.hasOlder).toBe(false);
  });

  it("loads older pages behind the cursor and never infers the end from a short page", async () => {
    const getTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item("wa:9", "2026-08-07T09:09:00Z")],
        nextPageToken: "cursor-1",
      })
      // A SHORT mid-history page with a live cursor: same-second bursts
      // narrow pages, so only the empty token means the end.
      .mockResolvedValueOnce({
        items: [item("wa:5", "2026-08-07T09:05:00Z")],
        nextPageToken: "cursor-2",
      })
      .mockResolvedValueOnce({
        items: [item("wa:1", "2026-08-07T09:01:00Z")],
        nextPageToken: "",
      });

    const { result } = renderHook(
      () => useConversationTimeline("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getTimeline)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.isLoadingOlder).toBe(false));
    expect(result.current.items.map((i) => i.itemId)).toEqual(["wa:5", "wa:9"]);
    expect(result.current.hasOlder).toBe(true);
    expect(getTimeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "cursor-1" }),
    );

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.isLoadingOlder).toBe(false));
    expect(result.current.items.map((i) => i.itemId)).toEqual(["wa:1", "wa:5", "wa:9"]);
    expect(result.current.hasOlder).toBe(false);
  });

  it("keeps items that slide out of the polled head window — nothing ever vanishes mid-scroll", async () => {
    const getTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item("wa:2", "2026-08-07T09:02:00Z"), item("wa:1", "2026-08-07T09:01:00Z")],
        nextPageToken: "",
      })
      // The refreshed head window has shifted entirely to newer items;
      // wa:1 and wa:2 are in no loaded page anymore.
      .mockResolvedValueOnce({
        items: [item("wa:4", "2026-08-07T09:04:00Z"), item("wa:3", "2026-08-07T09:03:00Z")],
        nextPageToken: "cursor-x",
      });

    const { result } = renderHook(
      () => useConversationTimeline("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getTimeline)) },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.items).toHaveLength(4));

    expect(result.current.items.map((i) => i.itemId)).toEqual([
      "wa:1",
      "wa:2",
      "wa:3",
      "wa:4",
    ]);
    // The older cursor stays anchored to the FIRST head page: it tracks
    // scroll depth into history, not the shifting head window.
    expect(result.current.hasOlder).toBe(false);
  });

  it("upserts mutated statuses in place — delivery and receipt ticks advance on poll", async () => {
    const sent = item("ob:1", "2026-08-07T09:00:00Z", {
      deliveryStatus: ChannelDeliveryStatus.delivered,
      receiptState: ChannelReceiptState.receipt_sent,
    });
    const read = item("ob:1", "2026-08-07T09:00:00Z", {
      deliveryStatus: ChannelDeliveryStatus.delivered,
      receiptState: ChannelReceiptState.receipt_read,
    });
    const getTimeline = vi
      .fn()
      .mockResolvedValueOnce({ items: [sent], nextPageToken: "" })
      .mockResolvedValueOnce({ items: [read], nextPageToken: "" });

    const { result } = renderHook(
      () => useConversationTimeline("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getTimeline)) },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].receiptState).toBe(ChannelReceiptState.receipt_sent);

    act(() => result.current.refetch());
    await waitFor(() =>
      expect(result.current.items[0].receiptState).toBe(ChannelReceiptState.receipt_read),
    );
    expect(result.current.items).toHaveLength(1);
  });

  it("keeps item and list references stable across polls that change nothing (DD-010)", async () => {
    const getTimeline = vi.fn().mockImplementation(() =>
      Promise.resolve({
        // Fresh-but-equal proto objects every call, like a real poll.
        items: [item("wa:1", "2026-08-07T09:00:00Z")],
        nextPageToken: "",
      }),
    );
    const { result } = renderHook(
      () => useConversationTimeline("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getTimeline)) },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const firstItems = result.current.items;

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isRefetching).toBe(false));

    expect(result.current.items).toBe(firstItems);
  });

  it("resets on identity change so conversation A's thread never flashes under B", async () => {
    const getTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item("wa:1", "2026-08-07T09:00:00Z")],
        nextPageToken: "cursor-a",
      })
      .mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useConversationTimeline("ach_1", key, NO_POLL),
      {
        wrapper: wrapper(createMockStigmer(getTimeline)),
        initialProps: { key: "15550001111" },
      },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ key: "15550002222" });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.hasOlder).toBe(false);
  });

  it("skips fetching for empty identity (stable no-op)", async () => {
    const getTimeline = vi.fn();
    const { result } = renderHook(() => useConversationTimeline("", "", NO_POLL), {
      wrapper: wrapper(createMockStigmer(getTimeline)),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it("records a loadOlder failure beside the control, leaving the loaded thread intact", async () => {
    const getTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item("wa:1", "2026-08-07T09:00:00Z")],
        nextPageToken: "cursor-1",
      })
      .mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(
      () => useConversationTimeline("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getTimeline)) },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadOlderError).not.toBeNull());

    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.hasOlder).toBe(true);
  });
});
