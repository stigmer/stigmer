import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSession } from "../useSession";

function createMockStigmer(overrides: {
  get?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    session: {
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

describe("useSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches session by ID", async () => {
    const session = {
      metadata: { id: "ses-1", name: "Test Session" },
      status: { subject: "Hello world" },
    };
    const get = vi.fn().mockResolvedValue(session);
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useSession("ses-1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.session).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.session).toBe(session);
    expect(result.current.error).toBeNull();
    expect(get).toHaveBeenCalledWith("ses-1");
  });

  it("skips fetching when id is null", () => {
    const get = vi.fn();
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useSession(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("exposes error on fetch failure", async () => {
    const apiError = new Error("Connection refused");
    const get = vi.fn().mockRejectedValue(apiError);
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useSession("ses-bad"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error!.message).toBe("Connection refused");
    expect(result.current.session).toBeNull();
  });

  it("refetch triggers a new fetch", async () => {
    const session = { metadata: { id: "ses-1" } };
    const get = vi.fn().mockResolvedValue(session);
    const client = createMockStigmer({ get });

    const { result } = renderHook(() => useSession("ses-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(get).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(result.current.session).toBe(session);
  });

  it("re-fetches when id changes", async () => {
    const session1 = { metadata: { id: "ses-1" } };
    const session2 = { metadata: { id: "ses-2" } };
    const get = vi.fn()
      .mockResolvedValueOnce(session1)
      .mockResolvedValueOnce(session2);
    const client = createMockStigmer({ get });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSession(id),
      {
        wrapper: wrapper(client),
        initialProps: { id: "ses-1" },
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBe(session1);

    rerender({ id: "ses-2" });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith("ses-2");
  });
});
