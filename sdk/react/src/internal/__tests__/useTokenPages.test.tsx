/**
 * useTokenPages shows one page at a time over a token-paged list: "next"
 * reads the page the shown page's token names, "previous" reads the page
 * before again, and each is a no-op at its end, so a pager that calls it
 * there reads nothing and stays where it is.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTokenPages } from "../useTokenPages";

const pages: Record<string, { entries: string[]; nextPageToken: string }> = {
  "": { entries: ["a", "b"], nextPageToken: "page-2" },
  "page-2": { entries: ["c"], nextPageToken: "" },
};

describe("useTokenPages", () => {
  it("moves next and previous by token, and stays put at either end", async () => {
    const read = vi.fn(async (token: string) => pages[token]!);
    const { result } = renderHook(() => useTokenPages<string>(read, []));
    await waitFor(() => expect(result.current.entries).toEqual(["a", "b"]));

    act(() => result.current.previous());
    expect(result.current.pageNumber).toBe(1);

    act(() => result.current.next());
    await waitFor(() => expect(result.current.entries).toEqual(["c"]));
    expect([result.current.pageNumber, result.current.hasNext, result.current.hasPrevious]).toEqual([2, false, true]);

    const reads = read.mock.calls.length;
    act(() => result.current.next());
    expect(result.current.pageNumber).toBe(2);
    expect(read.mock.calls.length).toBe(reads);

    act(() => result.current.previous());
    await waitFor(() => expect(result.current.entries).toEqual(["a", "b"]));
    expect(result.current.pageNumber).toBe(1);
  });
});
