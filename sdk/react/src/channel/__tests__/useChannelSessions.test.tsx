import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ListSessionsByChannelRequest } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useChannelSessions } from "../useChannelSessions";

function createMockStigmer(overrides: {
  listByChannel?: (input: ListSessionsByChannelRequest) => Promise<unknown>;
} = {}) {
  return {
    session: {
      listByChannel:
        overrides.listByChannel ?? vi.fn().mockResolvedValue({ entries: [] }),
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

function makeChannelSession(id: string, externalUser: string) {
  return {
    metadata: {
      id,
      org: "acme",
      labels: {
        "stigmer.ai/channel-id": "ach_1",
        "stigmer.ai/channel-external-user-key": externalUser,
      },
    },
    spec: { subject: `Conversation ${id}` },
  };
}

describe("useChannelSessions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the channel's conversations by channel id", async () => {
    const session = makeChannelSession("ses_1", "U0AB12CD3");
    const listByChannel = vi.fn().mockResolvedValue({ entries: [session] });
    const client = createMockStigmer({ listByChannel });

    const { result } = renderHook(() => useChannelSessions("ach_1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.sessions).toEqual([session]);
    expect(result.current.error).toBeNull();
    expect(listByChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "ach_1" }),
    );
  });

  it("skips fetching for an empty channel id (stable no-op)", async () => {
    const listByChannel = vi.fn();
    const client = createMockStigmer({ listByChannel });

    const { result } = renderHook(() => useChannelSessions(""), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions).toEqual([]);
    expect(listByChannel).not.toHaveBeenCalled();
  });

  it("surfaces a denial as the error state (caller cannot view the channel)", async () => {
    const denied = new Error("unauthorized to list channel conversations");
    const listByChannel = vi.fn().mockRejectedValue(denied);
    const client = createMockStigmer({ listByChannel });

    const { result } = renderHook(() => useChannelSessions("ach_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.sessions).toEqual([]);
  });
});
