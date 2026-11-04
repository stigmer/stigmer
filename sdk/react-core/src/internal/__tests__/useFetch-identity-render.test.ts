/**
 * `useFetch` never returns another identity's data or error, in any render.
 *
 * When the identity deps change (session A to session B), the render that
 * carries B's id must already show B's state: the provider's cached value
 * for B's key, or `initialData` while B loads, with no error. A consumer
 * that seeds state at render from the read (the session page seeds the
 * conversation's agent this way) would otherwise seed B from A's data in
 * that one render. `useFetch-identity-reset.test.ts` cannot see this: it
 * reads `result.current` after an `act`-wrapped rerender, which has already
 * flushed the effect. These tests log every value the hook returns, render
 * by render, and assert on each one after the switch.
 *
 * Pinned, for each caching shape (no key; a key under a provider, cache hit
 * and miss; a key with no provider mounted, an integrator's default):
 * - no render after the switch carries A's data or A's error;
 * - the switch render's loading flags say what the next fetch will be:
 *   `isLoading` with nothing to show, `isRefetching` over a cached value.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { FetchCacheContext } from "../FetchCacheProvider";
import { FetchCache } from "../fetch-cache";
import { useFetch, type UseFetchReturn } from "../useFetch";

/** A fetch per identity whose result the test settles by hand. */
function controlledFetches() {
  const settle = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  const fetchFor = (id: string) => () =>
    new Promise<string>((resolve, reject) => {
      settle.set(id, { resolve, reject });
    });
  return {
    fetchFor,
    async resolve(id: string, value: string) {
      await act(async () => {
        settle.get(id)!.resolve(value);
        await Promise.resolve();
      });
    },
    async reject(id: string, error: Error) {
      await act(async () => {
        settle.get(id)!.reject(error);
        await Promise.resolve();
      });
    },
  };
}

type Shape = { cacheKey: boolean; cache: FetchCache | null };

/** Renders `useFetch` for `id` and logs every value it returns. */
function renderLogged(shape: Shape, fetches: ReturnType<typeof controlledFetches>) {
  const log: { id: string; value: UseFetchReturn<string | null> }[] = [];
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FetchCacheContext.Provider, { value: shape.cache }, children);
  const hook = renderHook(
    ({ id }: { id: string }) => {
      const value = useFetch(fetches.fetchFor(id), [id], null as string | null, {
        cacheKey: shape.cacheKey ? `thing:${id}` : undefined,
      });
      log.push({ id, value });
      return value;
    },
    { wrapper, initialProps: { id: "A" } },
  );
  return { ...hook, log };
}

/** Every logged render from `from` on, for the id `id`. */
function rendersOf(log: { id: string; value: UseFetchReturn<string | null> }[], from: number, id: string) {
  const renders = log.slice(from).filter((entry) => entry.id === id);
  expect(renders.length).toBeGreaterThan(0);
  return renders.map((entry) => entry.value);
}

const SHAPES: [string, () => Shape][] = [
  ["no cache key", () => ({ cacheKey: false, cache: null })],
  ["a cache key under a provider", () => ({ cacheKey: true, cache: new FetchCache() })],
  ["a cache key with no provider mounted", () => ({ cacheKey: true, cache: null })],
];

describe("useFetch — no render crosses an identity", () => {
  it.each(SHAPES)("never shows A's data after the switch to B (%s)", async (_name, shapeOf) => {
    const fetches = controlledFetches();
    const { rerender, log } = renderLogged(shapeOf(), fetches);
    await fetches.resolve("A", "data-A");
    expect(log.at(-1)!.value.data).toBe("data-A");

    const from = log.length;
    rerender({ id: "B" });
    const switching = rendersOf(log, from, "B");
    expect(switching.map((v) => v.data)).not.toContain("data-A");
    expect(switching[0]).toMatchObject({ data: null, isLoading: true, isRefetching: false, error: null });

    await fetches.resolve("B", "data-B");
    expect(log.at(-1)!.value).toMatchObject({ data: "data-B", isLoading: false, error: null });
  });

  it.each(SHAPES)("never shows A's error after the switch to B (%s)", async (_name, shapeOf) => {
    const fetches = controlledFetches();
    const { rerender, log } = renderLogged(shapeOf(), fetches);
    await fetches.reject("A", new Error("A failed"));
    expect(log.at(-1)!.value.error?.message).toBe("A failed");

    const from = log.length;
    rerender({ id: "B" });
    for (const value of rendersOf(log, from, "B")) {
      expect(value.error).toBeNull();
    }
  });

  it("shows B's cached value in the switch render itself, refetching over it", async () => {
    const cache = new FetchCache();
    cache.set("thing:B", "cached-B");
    const fetches = controlledFetches();
    const { rerender, log } = renderLogged({ cacheKey: true, cache }, fetches);
    await fetches.resolve("A", "data-A");

    const from = log.length;
    rerender({ id: "B" });
    const switching = rendersOf(log, from, "B");
    expect(switching.map((v) => v.data)).not.toContain("data-A");
    expect(switching[0]).toMatchObject({ data: "cached-B", isLoading: false, isRefetching: true, error: null });

    await fetches.resolve("B", "fresh-B");
    expect(log.at(-1)!.value).toMatchObject({ data: "fresh-B", isRefetching: false });
  });

  it("returns to A without showing B's data, from A's cached value", async () => {
    const cache = new FetchCache();
    const fetches = controlledFetches();
    const { rerender, log } = renderLogged({ cacheKey: true, cache }, fetches);
    await fetches.resolve("A", "data-A");
    rerender({ id: "B" });
    await fetches.resolve("B", "data-B");

    const from = log.length;
    rerender({ id: "A" });
    const back = rendersOf(log, from, "A");
    expect(back.map((v) => v.data)).not.toContain("data-B");
    expect(back[0]).toMatchObject({ data: "data-A", isRefetching: true });
  });

  it("a disabled fetch shows initial data in the switch render, not loading", async () => {
    const fetches = controlledFetches();
    const log: UseFetchReturn<string | null>[] = [];
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => {
        const value = useFetch(id ? fetches.fetchFor(id) : null, [id], null as string | null);
        log.push(value);
        return value;
      },
      { initialProps: { id: "A" as string | null } },
    );
    await fetches.resolve("A", "data-A");

    const from = log.length;
    rerender({ id: null });
    const after = log.slice(from);
    expect(after.map((v) => v.data)).not.toContain("data-A");
    expect(after[0]).toMatchObject({ data: null, isLoading: false, isRefetching: false, error: null });
  });
});
