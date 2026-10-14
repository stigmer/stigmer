/**
 * useCursorPages accumulates a token-paged list: the first page, then each
 * page "Load more" reads. An explicit refetch follows a change the caller
 * made, so it re-reads every page loaded and drops a row the server no
 * longer holds, keeping the depth the reader had loaded; a read that fails
 * there surfaces as the load-more error, and a walk that lands after the
 * list changed is dropped, answered or failed.
 */
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCursorPages } from "../useCursorPages";

/** A server over `rows`, newest first, `size` a page, keyed by position. */
function server(rows: string[], size: number) {
  return {
    rows,
    read: async (token: string) => {
      const at = token === "" ? 0 : rows.indexOf(token) + 1;
      const entries = rows.slice(at, at + size);
      const last = entries[entries.length - 1];
      return { entries, nextPageToken: at + size < rows.length && last !== undefined ? last : "" };
    },
  };
}

const keys = Array.from({ length: 51 }, (_, i) => `key-${i + 1}`);

describe("useCursorPages", () => {
  it("drops a row deleted after Load more when the caller refetches, keeping the pages loaded", async () => {
    const api = server([...keys], 50);
    const { result } = renderHook(() => useCursorPages<string>(api.read, [], (row) => row));
    await waitFor(() => expect(result.current.items).toHaveLength(50));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(51));
    expect(result.current.hasMore).toBe(false);

    api.rows.splice(api.rows.indexOf("key-3"), 1);
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.items).not.toContain("key-3"));
    expect(result.current.items).toHaveLength(50);
    expect(result.current.items.at(-1)).toBe("key-51");
  });

  it("drops a refetch's walk, answered or failed, that lands after the list changed", async () => {
    const api = server([...keys], 50);
    const held: { release: () => void; fail: boolean }[] = [];
    let holding = false;
    const read = async (token: string) => {
      if (holding && token !== "") {
        const gate = { release: () => {}, fail: false };
        held.push(gate);
        await new Promise<void>((resolve) => (gate.release = resolve));
        if (gate.fail) throw new Error("store down");
      }
      return api.read(token);
    };
    const { result, rerender } = renderHook(({ list }) => useCursorPages<string>(read, [list], (row) => row), {
      initialProps: { list: "a" },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(51));

    holding = true;
    act(() => result.current.refetch());
    act(() => result.current.refetch());
    await waitFor(() => expect(held).toHaveLength(2));
    rerender({ list: "b" });
    await waitFor(() => expect(result.current.items).toHaveLength(50));
    held[1]!.fail = true;
    await act(async () => {
      held[0]!.release();
      held[1]!.release();
    });

    expect(result.current.items).toHaveLength(50);
    expect(result.current.loadMoreError).toBeNull();
  });

  it("surfaces a failed re-read of the loaded pages as the load-more error", async () => {
    const api = server([...keys], 50);
    let fail = false;
    const read = async (token: string) => {
      if (fail && token !== "") throw new Error("store down");
      return api.read(token);
    };
    const { result } = renderHook(() => useCursorPages<string>(read, [], (row) => row));
    await waitFor(() => expect(result.current.items).toHaveLength(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(51));

    fail = true;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.loadMoreError?.message).toBe("store down"));
  });
});
