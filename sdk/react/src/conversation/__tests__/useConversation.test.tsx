import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { StigmerError } from "@stigmer/sdk";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useConversation } from "../useConversation";

function row(overrides: { control?: ConversationControl; controlledBy?: string } = {}) {
  return create(ChannelConversationSchema, {
    agentChannelId: "ach_1",
    conversationKey: "15550001111",
    org: "acme",
    control: overrides.control ?? ConversationControl.control_agent,
    controlledBy: overrides.controlledBy ?? "",
    displayName: "Pat",
  });
}

function notFound() {
  return new StigmerError("not-found", "no conversation with this key exists on channel ach_1", 5);
}

function createMockStigmer(getConversation: (input: unknown) => Promise<unknown>) {
  return { agentChannel: { getConversation } } as never;
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

describe("useConversation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the conversation row", async () => {
    const getConversation = vi.fn().mockResolvedValue(row());
    const { result } = renderHook(
      () => useConversation("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getConversation)) },
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.conversation?.displayName).toBe("Pat");
    expect(result.current.awaitingCustomer).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getConversation).toHaveBeenCalledWith(
      expect.objectContaining({ agentChannelId: "ach_1", conversationKey: "15550001111" }),
    );
  });

  it("answers NOT_FOUND as the awaiting-customer state, never an error", async () => {
    const getConversation = vi.fn().mockRejectedValue(notFound());
    const { result } = renderHook(
      () => useConversation("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getConversation)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A cold-send conversation has a timeline before it has a row; the
    // hook must let consumers render "controls unlock when the customer
    // writes" rather than an error page.
    expect(result.current.awaitingCustomer).toBe(true);
    expect(result.current.conversation).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces every other failure as the error state", async () => {
    const getConversation = vi
      .fn()
      .mockRejectedValue(new StigmerError("permission-denied", "unauthorized", 7));
    const { result } = renderHook(
      () => useConversation("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getConversation)) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.awaitingCustomer).toBe(false);
    expect(result.current.conversation).toBeNull();
  });

  it("skips fetching for empty identity (stable no-op)", async () => {
    const getConversation = vi.fn();
    const { result } = renderHook(() => useConversation("", "", NO_POLL), {
      wrapper: wrapper(createMockStigmer(getConversation)),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getConversation).not.toHaveBeenCalled();
  });

  it("fences a stale in-flight poll behind applyServerState — command truth is never overwritten", async () => {
    // Sequence: the first read answers agent-held; a second read is
    // started and parked in flight; a takeover response is applied; the
    // parked read then resolves with the PRE-command state. The fence
    // must discard it — otherwise the control banner flips back to
    // "agent" under the cursor of the human who just took over, until
    // the next poll corrects it.
    let release: (value: unknown) => void = () => {};
    const parked = new Promise((resolve) => {
      release = resolve;
    });
    const getConversation = vi
      .fn()
      .mockResolvedValueOnce(row())
      .mockReturnValueOnce(parked);

    const { result } = renderHook(
      () => useConversation("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getConversation)) },
    );
    await waitFor(() =>
      expect(result.current.conversation?.control).toBe(ConversationControl.control_agent),
    );

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isRefetching).toBe(true));

    const taken = row({ control: ConversationControl.control_human, controlledBy: "idt_me" });
    act(() => result.current.applyServerState(taken));
    expect(result.current.conversation?.control).toBe(ConversationControl.control_human);

    await act(async () => {
      release(row());
      await parked;
    });

    expect(result.current.conversation?.control).toBe(ConversationControl.control_human);
    expect(result.current.conversation?.controlledBy).toBe("idt_me");
    // The fenced answer still settles the in-flight flag, so polling
    // can resume — a stranded flag would silence liveness forever.
    await waitFor(() => expect(result.current.isRefetching).toBe(false));
  });

  it("resets state on identity change so channel A never renders under channel B", async () => {
    const getConversation = vi
      .fn()
      .mockResolvedValueOnce(row())
      .mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useConversation("ach_1", key, NO_POLL),
      {
        wrapper: wrapper(createMockStigmer(getConversation)),
        initialProps: { key: "15550001111" },
      },
    );
    await waitFor(() => expect(result.current.conversation).not.toBeNull());

    rerender({ key: "15550002222" });

    expect(result.current.conversation).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("keeps the row reference stable across polls that change nothing (DD-010)", async () => {
    const getConversation = vi.fn().mockImplementation(() => Promise.resolve(row()));
    const { result } = renderHook(
      () => useConversation("ach_1", "15550001111", NO_POLL),
      { wrapper: wrapper(createMockStigmer(getConversation)) },
    );
    await waitFor(() => expect(result.current.conversation).not.toBeNull());
    const first = result.current.conversation;

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isRefetching).toBe(false));

    expect(result.current.conversation).toBe(first);
  });
});
