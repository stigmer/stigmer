import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChannelConversationListFilter } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useConversationsWantsHumanCount } from "../useConversationsWantsHumanCount";

// The focus-refetch test broadcasts window events, which reach EVERY
// still-mounted hook in this file. Unmount between tests so a window
// broadcast only ever exercises the test that sent it.
afterEach(cleanup);

function createMockStigmer(countConversations: (input: unknown) => Promise<unknown>) {
  return { channel: { countConversations } } as never;
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

  it("reads countConversations with the wants-human filter — the list's own predicate", async () => {
    const countConversations = vi.fn().mockResolvedValue({ count: 7 });
    const { result } = renderHook(
      () => useConversationsWantsHumanCount("acme", NO_POLL),
      { wrapper: wrapper(createMockStigmer(countConversations)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(7);
    expect(countConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        filter: ChannelConversationListFilter.filter_wants_human,
      }),
    );
  });

  it("skips fetching without an org and answers zero", async () => {
    const countConversations = vi.fn();
    const { result } = renderHook(
      () => useConversationsWantsHumanCount(null, NO_POLL),
      { wrapper: wrapper(createMockStigmer(countConversations)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(countConversations).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it("keeps the stale count visible through a failed refresh — a flapping badge teaches distrust", async () => {
    const countConversations = vi
      .fn()
      .mockResolvedValueOnce({ count: 4 })
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(
      () => useConversationsWantsHumanCount("acme", NO_POLL),
      { wrapper: wrapper(createMockStigmer(countConversations)) },
    );
    await waitFor(() => expect(result.current.count).toBe(4));

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.count).toBe(4);
  });

  it("refetches when the window regains focus", async () => {
    const countConversations = vi.fn().mockResolvedValue({ count: 0 });
    renderHook(() => useConversationsWantsHumanCount("acme", NO_POLL), {
      wrapper: wrapper(createMockStigmer(countConversations)),
    });
    await waitFor(() => expect(countConversations).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(countConversations).toHaveBeenCalledTimes(2));
  });
});
