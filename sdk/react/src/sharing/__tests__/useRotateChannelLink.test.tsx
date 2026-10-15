import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RotateShareLinkInput } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { StigmerContext } from "../../context";
import { useRotateShareLink } from "../useRotateShareLink";

function createMockStigmer(overrides: {
  rotateShareLink?: (input: RotateShareLinkInput) => Promise<unknown>;
} = {}) {
  return {
    agentShare: {
      rotateShareLink:
        overrides.rotateShareLink ?? vi.fn().mockResolvedValue({}),
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

describe("useRotateShareLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls rotateShareLink with the share id and returns the updated share", async () => {
    const rotated = {
      metadata: { id: "ash_1" },
      status: { shareLinkToken: "fresh-token" },
    };
    const rotateShareLink = vi.fn().mockResolvedValue(rotated);
    const client = createMockStigmer({ rotateShareLink });

    const { result } = renderHook(() => useRotateShareLink("ash_1"), {
      wrapper: wrapper(client),
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.rotateShareLink();
    });

    expect(rotateShareLink).toHaveBeenCalledTimes(1);
    const input = rotateShareLink.mock.calls[0][0] as RotateShareLinkInput;
    expect(input.resourceId).toBe("ash_1");
    // The server generates the token — the request carries nothing but the id.
    expect(Object.keys(input)).not.toContain("linkToken");
    expect(returned).toBe(rotated);
    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("is a stable no-op while shareId is null (agent never shared)", async () => {
    const rotateShareLink = vi.fn();
    const client = createMockStigmer({ rotateShareLink });

    const { result } = renderHook(() => useRotateShareLink(null), {
      wrapper: wrapper(client),
    });

    let returned: unknown = "sentinel";
    await act(async () => {
      returned = await result.current.rotateShareLink();
    });

    expect(returned).toBeUndefined();
    expect(rotateShareLink).not.toHaveBeenCalled();
  });

  it("exposes RPC failures via error and rethrows for the caller", async () => {
    const failure = new Error("unauthorized to rotate agent share link");
    const rotateShareLink = vi.fn().mockRejectedValue(failure);
    const client = createMockStigmer({ rotateShareLink });

    const { result } = renderHook(() => useRotateShareLink("ash_1"), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.rotateShareLink()).rejects.toThrow(
        "unauthorized to rotate agent share link",
      );
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.isPending).toBe(false);
  });
});
