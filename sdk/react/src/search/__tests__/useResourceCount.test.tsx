import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ListParams, ListResult } from "@stigmer/sdk";
import { useResourceCount } from "../useResourceCount";

function mockListFn(totalCount = 0) {
  return vi.fn<(params: ListParams) => Promise<ListResult>>().mockResolvedValue({
    entries: [],
    totalCount,
    totalPages: totalCount > 0 ? 1 : 0,
  } as never);
}

describe("useResourceCount", () => {
  it("always sends the org with a one-row page (an empty org means every org the caller can access to the search backend)", async () => {
    const listFn = mockListFn(7);

    const { result } = renderHook(() => useResourceCount(listFn, "acme"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(7);
    const params = listFn.mock.calls[0][0];
    expect(params.org).toBe("acme");
    expect(params.page).toEqual({ num: 1, size: 1 });
  });

  it("does not fetch when org is null", async () => {
    const listFn = mockListFn();

    const { result } = renderHook(() => useResourceCount(listFn, null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listFn).not.toHaveBeenCalled();
    expect(result.current.count).toBeUndefined();
  });

  it("recounts when refetchToken changes", async () => {
    const listFn = mockListFn(1);

    const { result, rerender } = renderHook(
      ({ token }: { token: number }) =>
        useResourceCount(listFn, "acme", { refetchToken: token }),
      { initialProps: { token: 0 } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listFn).toHaveBeenCalledTimes(1);

    rerender({ token: 1 });

    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2));
  });

  it("refetches with the new org when the org changes", async () => {
    const listFn = mockListFn(2);

    const { result, rerender } = renderHook(
      ({ org }: { org: string }) => useResourceCount(listFn, org),
      { initialProps: { org: "acme" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ org: "globex" });

    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2));
    expect(listFn.mock.calls[1][0].org).toBe("globex");
  });
});
