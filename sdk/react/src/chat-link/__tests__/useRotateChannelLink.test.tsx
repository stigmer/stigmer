// useRotateChannelLink: rotating a web channel's chat-link token through
// the channel's rotateLink RPC, a no-op until a channel exists.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RotateChannelLinkInput } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/io_pb";
import { StigmerContext } from "../../context";
import { useRotateChannelLink } from "../useRotateChannelLink";

function createMockStigmer(overrides: {
  rotateLink?: (input: RotateChannelLinkInput) => Promise<unknown>;
} = {}) {
  return {
    channel: {
      rotateLink:
        overrides.rotateLink ?? vi.fn().mockResolvedValue({}),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

describe("useRotateChannelLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls rotateLink with the channel id and returns the updated channel", async () => {
    const rotated = {
      metadata: { id: "ash_1" },
      status: { typeStatus: { case: "web", value: { linkToken: "fresh-token" } } },
    };
    const rotateLink = vi.fn().mockResolvedValue(rotated);
    const client = createMockStigmer({ rotateLink });

    const { result } = renderHook(() => useRotateChannelLink("ash_1"), {
      wrapper: wrapper(client),
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.rotateLink();
    });

    expect(rotateLink).toHaveBeenCalledTimes(1);
    const input = rotateLink.mock.calls[0][0] as RotateChannelLinkInput;
    expect(input.resourceId).toBe("ash_1");
    // The server generates the token — the request carries nothing but the id.
    expect(Object.keys(input)).not.toContain("linkToken");
    expect(returned).toBe(rotated);
    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("is a stable no-op while channelId is null (no chat link yet)", async () => {
    const rotateLink = vi.fn();
    const client = createMockStigmer({ rotateLink });

    const { result } = renderHook(() => useRotateChannelLink(null), {
      wrapper: wrapper(client),
    });

    let returned: unknown = "sentinel";
    await act(async () => {
      returned = await result.current.rotateLink();
    });

    expect(returned).toBeUndefined();
    expect(rotateLink).not.toHaveBeenCalled();
  });

  it("exposes RPC failures via error and rethrows for the caller", async () => {
    const failure = new Error("unauthorized to rotate channel link");
    const rotateLink = vi.fn().mockRejectedValue(failure);
    const client = createMockStigmer({ rotateLink });

    const { result } = renderHook(() => useRotateChannelLink("ash_1"), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.rotateLink()).rejects.toThrow(
        "unauthorized to rotate channel link",
      );
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.isPending).toBe(false);
  });
});
