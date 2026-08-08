import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChannelConversationListFilter } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useConversationsWantsHumanCount } from "../useConversationsWantsHumanCount";

// The focus-refetch test broadcasts window events, which reach EVERY
// still-mounted hook in this file. Unmount between tests so a window
// broadcast only ever exercises the test that sent it.
afterEach(cleanup);

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

describe("useConversationsWantsHumanCount", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the filtered list's total_count with a one-row page — zero dedicated RPCs (DD-011 D-g)", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValue({ items: [], totalCount: 7 });
    const { result } = renderHook(
      () => useConversationsWantsHumanCount("acme", NO_POLL),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(7);
    expect(listConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        filter: ChannelConversationListFilter.filter_wants_human,
        pageInfo: expect.objectContaining({ num: 1, size: 1 }),
      }),
    );
  });

  it("skips fetching without an org and answers zero", async () => {
    const listConversations = vi.fn();
    const { result } = renderHook(
      () => useConversationsWantsHumanCount(null, NO_POLL),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listConversations).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it("keeps the stale count visible through a failed refresh — a flapping badge teaches distrust", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [], totalCount: 4 })
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(
      () => useConversationsWantsHumanCount("acme", NO_POLL),
      { wrapper: wrapper(createMockStigmer(listConversations)) },
    );
    await waitFor(() => expect(result.current.count).toBe(4));

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.count).toBe(4);
  });

  it("refetches when the window regains focus (DD-012: refocus is fresh)", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValue({ items: [], totalCount: 2 });
    renderHook(() => useConversationsWantsHumanCount("acme", NO_POLL), {
      wrapper: wrapper(createMockStigmer(listConversations)),
    });
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
  });
});
