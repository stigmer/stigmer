/**
 * Pins useSessionList and, through it, the cursor-list machinery the list
 * hooks share (internal/useCursorPages): the first page and its request
 * (page size, organization), loadMore appending the next page from the
 * tail's token, a short page that still carries a token being followed, a
 * refetched first page merging with the loaded rows without a gap, and an
 * answer that lands after the list's identity changed being dropped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSessionList } from "../useSessionList";

type ListFn = (...args: unknown[]) => Promise<unknown>;

function createMockStigmer(overrides: { list?: ListFn } = {}) {
  return {
    session: {
      list: overrides.list ?? vi.fn().mockResolvedValue({ entries: [], totalPages: 0, nextPageToken: "" }),
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

function session(id: string) {
  return { metadata: { id, name: id } };
}

function page(ids: string[], nextPageToken = "") {
  return { entries: ids.map(session), totalPages: nextPageToken === "" ? 1 : 0, nextPageToken };
}

function idsOf(sessions: readonly { metadata?: { id?: string } }[]) {
  return sessions.map((s) => s.metadata?.id);
}

function requestOf(list: ReturnType<typeof vi.fn>, call: number) {
  return list.mock.calls[call]![0] as { pageSize: number; pageToken: string; org: string };
}

describe("useSessionList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the first page with the default page size and every organization", async () => {
    const list = vi.fn().mockResolvedValue(page(["ses-1", "ses-2"]));
    const client = createMockStigmer({ list });

    const { result } = renderHook(() => useSessionList(), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sessions).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(idsOf(result.current.sessions)).toEqual(["ses-1", "ses-2"]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(requestOf(list, 0)).toMatchObject({ pageSize: 50, pageToken: "", org: "" });
  });

  it("passes the page size and organization to the API", async () => {
    const list = vi.fn().mockResolvedValue(page([]));
    const client = createMockStigmer({ list });

    renderHook(() => useSessionList({ pageSize: 10, org: "acme" }), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(requestOf(list, 0)).toMatchObject({ pageSize: 10, org: "acme" });
  });

  it("loadMore appends the next page from the first page's token", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["ses-3", "ses-2"], "t1"))
      .mockResolvedValueOnce(page(["ses-1"]));
    const { result } = renderHook(() => useSessionList({ pageSize: 2 }), {
      wrapper: wrapper(createMockStigmer({ list })),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    expect(result.current.isLoadingMore).toBe(true);
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(requestOf(list, 1).pageToken).toBe("t1");
    expect(idsOf(result.current.sessions)).toEqual(["ses-3", "ses-2", "ses-1"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("loadMore follows an empty page that still carries a token", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["ses-9"], "t1"))
      .mockResolvedValueOnce(page([], "t2"))
      .mockResolvedValueOnce(page(["ses-4"], "t3"));
    const { result } = renderHook(() => useSessionList({ pageSize: 1 }), {
      wrapper: wrapper(createMockStigmer({ list })),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(list).toHaveBeenCalledTimes(3);
    expect(idsOf(result.current.sessions)).toEqual(["ses-9", "ses-4"]);
    expect(result.current.hasMore).toBe(true);
  });

  it("a refetched first page keeps the loaded rows, with nothing lost between them", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["ses-3", "ses-2"], "t1"))
      .mockResolvedValueOnce(page(["ses-1"]))
      // A session created since pushes ses-2 off the first page.
      .mockResolvedValueOnce(page(["ses-4", "ses-3"], "t9"));
    const { result } = renderHook(() => useSessionList({ pageSize: 2 }), {
      wrapper: wrapper(createMockStigmer({ list })),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));

    act(() => result.current.refetch());
    await waitFor(() => expect(idsOf(result.current.sessions)[0]).toBe("ses-4"));

    expect(idsOf(result.current.sessions)).toEqual(["ses-4", "ses-3", "ses-2", "ses-1"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("drops a loadMore answer that lands after the organization changed", async () => {
    let resolveMore: (value: unknown) => void = () => {};
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["acme-2"], "t1"))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveMore = resolve)))
      .mockResolvedValueOnce(page(["beta-1"]));
    const { result, rerender } = renderHook(({ org }) => useSessionList({ org }), {
      initialProps: { org: "acme" },
      wrapper: wrapper(createMockStigmer({ list })),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());

    rerender({ org: "beta" });
    await waitFor(() => expect(idsOf(result.current.sessions)).toEqual(["beta-1"]));
    await act(async () => resolveMore(page(["acme-1"])));

    expect(idsOf(result.current.sessions)).toEqual(["beta-1"]);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it("exposes a failed loadMore without losing the loaded rows", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["ses-2"], "t1"))
      .mockRejectedValueOnce(new Error("Network failure"));
    const { result } = renderHook(() => useSessionList(), {
      wrapper: wrapper(createMockStigmer({ list })),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull());

    expect(result.current.loadMoreError!.message).toBe("Network failure");
    expect(idsOf(result.current.sessions)).toEqual(["ses-2"]);
    expect(result.current.hasMore).toBe(true);
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
