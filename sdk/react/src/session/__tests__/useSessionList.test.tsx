import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSessionList } from "../useSessionList";

function createMockStigmer(overrides: {
  list?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    session: {
      list: overrides.list ?? vi.fn().mockResolvedValue({ entries: [], totalPages: 0 }),
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

describe("useSessionList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches session list with default page size", async () => {
    const sessions = [
      { metadata: { id: "ses-1", name: "Session 1" } },
      { metadata: { id: "ses-2", name: "Session 2" } },
    ];
    const list = vi.fn().mockResolvedValue({ entries: sessions, totalPages: 1 });
    const client = createMockStigmer({ list });

    const { result } = renderHook(() => useSessionList(), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sessions).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("passes custom page size to the API", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [], totalPages: 0 });
    const client = createMockStigmer({ list });

    renderHook(() => useSessionList({ pageSize: 10 }), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(list).toHaveBeenCalled());

    const callArg = list.mock.calls[0][0];
    expect(callArg.pageSize).toBe(10);
  });

  it("exposes error on fetch failure", async () => {
    const apiError = new Error("Network failure");
    const list = vi.fn().mockRejectedValue(apiError);
    const client = createMockStigmer({ list });

    const { result } = renderHook(() => useSessionList(), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error!.message).toBe("Network failure");
    expect(result.current.sessions).toEqual([]);
  });
});
