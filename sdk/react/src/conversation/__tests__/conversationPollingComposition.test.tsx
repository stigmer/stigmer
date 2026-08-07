import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { advanceInSlices } from "../../internal/__tests__/fake-timer-slices";
import { useConversation } from "../useConversation";
import { useConversationTimeline } from "../useConversationTimeline";

/**
 * The F-14 composition net (channel-conversations T06): the open
 * conversation mounts BOTH `useConversation` (the row poll, a
 * hand-rolled loop with stable deps) and `useConversationTimeline` (a
 * `useFetch` poll) in one component — the `ConversationsWorkbench`
 * shape. The row poll re-renders that component at fetch-start and at
 * settle every cycle; the timeline's poll must survive those renders.
 *
 * In production both hooks default to 5s and the timeline starved
 * deterministically. The intervals here are OFFSET (row 3s, timeline
 * 5s) because aligned periods mask the defect under fake timers: two
 * timers sharing a phase both fire inside the same advanced instant,
 * before React commits the re-render that would tear the poll timer
 * down. With the row poll at 3s, the timeline's 5s window can never
 * elapse untouched — unless its timer keeps its phase across renders,
 * which is the behavior this test pins.
 */

function conversationRow() {
  return create(ChannelConversationSchema, {
    agentChannelId: "ach_1",
    conversationKey: "15550001111",
    org: "acme",
    displayName: "Pat",
    control: ConversationControl.control_agent,
    lastActivityAt: timestampFromDate(new Date("2026-08-07T11:00:00Z")),
  });
}

function createMockStigmer() {
  return {
    agentChannel: {
      getConversation: vi.fn().mockResolvedValue(conversationRow()),
      getTimeline: vi.fn().mockResolvedValue({ items: [], nextPageToken: "" }),
    },
  };
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("conversation polling composition (F-14)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the timeline keeps polling under the row poll's render cadence", async () => {
    const client = createMockStigmer();
    renderHook(
      () => {
        const detail = useConversation("ach_1", "15550001111", {
          refetchIntervalMs: 3000,
        });
        const timeline = useConversationTimeline("ach_1", "15550001111", {
          refetchIntervalMs: 5000,
        });
        return { detail, timeline };
      },
      { wrapper: wrapper(client) },
    );

    // Flush the initial fetches of both hooks.
    await act(async () => {
      await Promise.resolve();
    });
    expect(client.agentChannel.getConversation).toHaveBeenCalledTimes(1);
    expect(client.agentChannel.getTimeline).toHaveBeenCalledTimes(1);

    // 15 seconds: the row poll fires at 3s, 6s, 9s, 12s, 15s — each
    // firing re-renders the component twice (fetch-start and settle).
    // The timeline poll must still fire at 5s, 10s, and 15s.
    await advanceInSlices(15_000);
    expect(client.agentChannel.getConversation).toHaveBeenCalledTimes(6);
    expect(client.agentChannel.getTimeline).toHaveBeenCalledTimes(4);
  });
});
