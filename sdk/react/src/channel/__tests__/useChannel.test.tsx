import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentChannel } from "../useAgentChannel";

function createMockStigmer(overrides: {
  get?: (id: string) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      get: overrides.get ?? vi.fn().mockResolvedValue(null),
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

describe("useAgentChannel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a channel by id", async () => {
    const channel = {
      metadata: { id: "ach_1", org: "acme", slug: "support-slack" },
      spec: { enabled: true },
    };
    const get = vi.fn().mockResolvedValue(channel);
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useAgentChannel("ach_1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.channel).toEqual(channel);
    expect(result.current.error).toBeNull();
    expect(get).toHaveBeenCalledWith("ach_1");
  });

  it("maps not-found to null data, not an error", async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new StigmerError("not-found", "AgentChannel not found: ach_1", 5));
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useAgentChannel("ach_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A deleted channel is a renderable state (e.g. removed in another
    // tab), not an error condition.
    expect(result.current.channel).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("exposes non-not-found failures as errors", async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new StigmerError("internal", "boom", 13));
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useAgentChannel("ach_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.channel).toBeNull();
  });

  it("skips fetching while the id is empty (stable no-op)", () => {
    const get = vi.fn();
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useAgentChannel(""), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.channel).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("refetches on demand", async () => {
    const get = vi.fn().mockResolvedValue({ metadata: { id: "ach_1" } });
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useAgentChannel("ach_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(get).toHaveBeenCalledTimes(1);

    result.current.refetch();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
