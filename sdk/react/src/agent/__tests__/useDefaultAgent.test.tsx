import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useDefaultAgent } from "../useDefaultAgent";

function createMockStigmer(overrides: {
  getDefault?: () => Promise<unknown>;
} = {}) {
  return {
    agent: {
      getDefault: overrides.getDefault ?? vi.fn().mockResolvedValue(null),
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

describe("useDefaultAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns loading state initially and resolves with agent data", async () => {
    const agent = { metadata: { id: "agt-1", name: "Default Agent" }, status: { defaultInstanceId: "ain-1" } };
    const getDefault = vi.fn().mockResolvedValue(agent);
    const client = createMockStigmer({ getDefault });

    const { result } = renderHook(() => useDefaultAgent("test-org"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.agent).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.agent).toBe(agent);
    expect(result.current.error).toBeNull();
    expect(getDefault).toHaveBeenCalledTimes(1);
  });

  it("skips fetching when org is null", () => {
    const getDefault = vi.fn();
    const client = createMockStigmer({ getDefault });

    const { result } = renderHook(() => useDefaultAgent(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.agent).toBeNull();
    expect(result.current.error).toBeNull();
    expect(getDefault).not.toHaveBeenCalled();
  });

  it("exposes error when fetch fails after retry", async () => {
    const apiError = new Error("Service unavailable");
    const getDefault = vi.fn().mockRejectedValue(apiError);
    const client = createMockStigmer({ getDefault });

    const { result } = renderHook(() => useDefaultAgent("test-org"), {
      wrapper: wrapper(client),
    });

    // useDefaultAgent retries once (MAX_RETRIES=1) with a 1s delay.
    // useFetch wraps the retry fn, so the final error surfaces after
    // both attempts fail. Wait for the error to propagate.
    await waitFor(() => expect(result.current.error).toBeTruthy(), { timeout: 10_000 });

    expect(result.current.error!.message).toBe("Service unavailable");
    expect(result.current.agent).toBeNull();
    expect(result.current.isLoading).toBe(false);
    // 1 initial + 1 retry = 2 calls
    expect(getDefault).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("refetch triggers a new fetch", async () => {
    let callCount = 0;
    const agent = { metadata: { id: "agt-1" }, status: { defaultInstanceId: "ain-1" } };
    const getDefault = vi.fn().mockImplementation(async () => {
      callCount++;
      return agent;
    });
    const client = createMockStigmer({ getDefault });

    const { result } = renderHook(() => useDefaultAgent("test-org"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(callCount).toBe(1);

    act(() => result.current.refetch());

    await waitFor(() => expect(callCount).toBe(2), { timeout: 10_000 });
  }, 15_000);
});
