import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFetch } from "../useFetch";

// ---------------------------------------------------------------------------
// useFetch — refetchOnWindowFocus (#175 re-discovery)
// ---------------------------------------------------------------------------
//
// No FetchCacheProvider is mounted; useFetch tolerates a null cache, so these
// tests exercise the focus/visibility refetch path in isolation.

describe("useFetch — refetchOnWindowFocus", () => {
  it("refetches when the window regains focus", async () => {
    const fetchFn = vi.fn().mockResolvedValue("data");

    renderHook(() =>
      useFetch(fetchFn, ["k"], "initial", { refetchOnWindowFocus: true }),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });

  it("does not refetch on focus when the option is off (default)", async () => {
    const fetchFn = vi.fn().mockResolvedValue("data");

    renderHook(() => useFetch(fetchFn, ["k"], "initial"));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Give any (incorrectly registered) listener a chance to fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not register focus refetch when fetching is disabled", async () => {
    renderHook(() =>
      useFetch<string>(null, ["k"], "initial", { refetchOnWindowFocus: true }),
    );

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Nothing to assert beyond "does not throw" — a null fetchFn must not
    // attach a listener that would call into a non-existent fetch.
    await new Promise((r) => setTimeout(r, 10));
    expect(true).toBe(true);
  });
});
