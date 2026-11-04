"use client";

import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { useFetchCache } from "./FetchCacheProvider.js";
import { toError } from "./toError.js";

/** Options for {@link useFetch}. */
export interface UseFetchOptions {
  /**
   * Poll interval in milliseconds. When set to a positive number, the
   * hook re-fetches on a timer. Set to `false` or `0` to disable.
   *
   * The timer is paused while a fetch is already in flight to prevent
   * request piling on slow connections.
   */
  readonly refetchInterval?: number | false;

  /**
   * Re-fetch when the window regains focus or the tab becomes visible
   * again. Covers the app-relaunch / tab-switch case where data may have
   * gone stale while the app was backgrounded. A focus refetch is skipped
   * while a fetch is already in flight. Defaults to `false`.
   */
  readonly refetchOnWindowFocus?: boolean;

  /**
   * Stable string key for cross-mount caching.
   *
   * When provided (and a {@link FetchCacheProvider} is mounted above
   * this component), the hook reads cached data on mount to avoid a
   * loading skeleton, and writes fresh data to the cache on every
   * successful fetch.
   *
   * Pass `undefined` to opt out of caching for a given call.
   *
   * @example `session:${id}`
   * @example `session-executions:${sessionId}`
   */
  readonly cacheKey?: string;
}

/** Return value of {@link useFetch}. */
export interface UseFetchReturn<T> {
  /** The most recently resolved data, or `initialData` before the first success. */
  readonly data: T;
  /**
   * `true` only when no data has been fetched yet (first load).
   * Once data arrives, subsequent refetches keep this `false`.
   */
  readonly isLoading: boolean;
  /**
   * `true` while a background refetch is in flight and stale data is
   * being shown. Always `false` during the initial load.
   */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Imperatively trigger a re-fetch. Stale data remains visible. */
  readonly refetch: () => void;
}

/**
 * Generic data-fetching hook with stale-while-revalidate semantics.
 *
 * - Pass `null` for `fetchFn` to disable fetching (idle state).
 * - On the **first** fetch, `isLoading` is `true` so consumers can
 *   show a skeleton.
 * - On **subsequent** fetches (refetch or dep change after first success),
 *   `isLoading` stays `false` and `isRefetching` becomes `true` —
 *   existing data remains visible, preventing skeleton flash.
 * - On error during a refetch, stale data is preserved.
 * - Data never crosses an identity, in any render: the render whose deps
 *   differ from the ones the held data belongs to already returns the new
 *   identity's state (its cached value, else `initialData`), never the
 *   previous identity's data or error.
 *
 * @param fetchFn  Async function that returns data, or `null` to skip.
 * @param deps     Dependency list — a new fetch fires when any dep changes.
 * @param initialData  Value returned before the first successful fetch.
 * @param options  Optional configuration (e.g. polling interval).
 *
 * @internal Not part of the public `@stigmer/react-sdk` API.
 */
export function useFetch<T>(
  fetchFn: (() => Promise<T>) | null,
  deps: DependencyList,
  initialData: T,
  options?: UseFetchOptions,
): UseFetchReturn<T> {
  const cache = useFetchCache();
  const cacheKey = options?.cacheKey;

  // Resolve initial state from cache when available. The initializer
  // function runs once on mount — exactly the right time to seed state
  // from a previous mount's result and skip the loading skeleton.
  const [data, setData] = useState<T>(() => {
    if (cacheKey && cache) {
      const cached = cache.get<T>(cacheKey);
      if (cached !== undefined) return cached;
    }
    return initialData;
  });
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const hasDataRef = useRef(
    cacheKey && cache ? cache.has(cacheKey) : false,
  );
  const isFetchingRef = useRef(fetchFn !== null);
  const [isFetching, setIsFetching] = useState(fetchFn !== null);

  // Stable ref for cache — avoids adding cache to effect deps while
  // still letting the effect body access the current instance.
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // The identity deps the held `data` and `error` belong to. The effect
  // compares against them to tell an identity change (e.g. executionId
  // A→B) from a plain refetch(): identity changes reset the stored data,
  // refetches keep it for stale-while-revalidate rendering. Written only in
  // the effect, so a render reads the deps of the committed state.
  const prevIdentityDepsRef = useRef<DependencyList>(deps);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!fetchFn) {
      setData(initialData);
      setIsFetching(false);
      isFetchingRef.current = false;
      setError(null);
      hasDataRef.current = false;
      prevIdentityDepsRef.current = deps;
      return;
    }

    const identityChanged = !sameDeps(deps, prevIdentityDepsRef.current);
    prevIdentityDepsRef.current = deps;

    // On identity dep change, store the new identity's starting point (what
    // the render already returned, below), so stale data from a different
    // identity (e.g. session A's data while session B loads) is never kept,
    // with or without a cache provider. On plain refetch(), skip the reset:
    // stale data stays visible.
    if (identityChanged) {
      const cached = cacheKey && cacheRef.current ? cacheRef.current.get<T>(cacheKey) : undefined;
      setData(cached !== undefined ? cached : initialData);
      hasDataRef.current = cached !== undefined;
    }

    const cancelled = { current: false };
    setIsFetching(true);
    isFetchingRef.current = true;
    setError(null);

    fetchFn().then(
      (result) => {
        if (cancelled.current) return;
        setData(result);
        hasDataRef.current = true;
        setIsFetching(false);
        isFetchingRef.current = false;
        if (cacheKey && cacheRef.current) {
          cacheRef.current.set(cacheKey, result);
        }
      },
      (err) => {
        if (cancelled.current) return;
        setError(toError(err));
        setIsFetching(false);
        isFetchingRef.current = false;
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [...deps, fetchKey]);

  // The two effects below use `fetchFn` only as an enabled/disabled
  // signal — they trigger fetches through `refetch()`, and the fetch
  // effect above already closes over the current render's `fetchFn`.
  // Keying them on this boolean instead of on `fetchFn` itself is
  // load-bearing: consumers pass inline closures (referentially new
  // every render), so an identity dep tears the interval down on every
  // render — and under any co-mounted faster render source the timer
  // never completes a period and the consumer never polls at all
  // (pinned by the render-pressure tests).
  const fetchEnabled = fetchFn !== null;

  const refetchInterval = options?.refetchInterval;
  useEffect(() => {
    if (!refetchInterval || refetchInterval <= 0 || !fetchEnabled) return;
    const id = setInterval(() => {
      if (!isFetchingRef.current) refetch();
    }, refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval, fetchEnabled, refetch]);

  const refetchOnWindowFocus = options?.refetchOnWindowFocus;
  useEffect(() => {
    if (!refetchOnWindowFocus || !fetchEnabled) return;
    if (typeof window === "undefined") return;
    const onActive = () => {
      if (!isFetchingRef.current) refetch();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onActive();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetchOnWindowFocus, fetchEnabled, refetch]);

  // The render that carries new identity deps runs before the effect that
  // resets the stored state, so it returns what that effect is about to
  // store: the new key's cached value, else `initialData` (always, for a
  // disabled fetch), with no error, and the loading flags of the fetch that
  // effect starts. Without this, a consumer seeding state at render from
  // `data` (the session page seeds its agent from the session read) would
  // seed the new identity from the previous one's data in that one render.
  if (!sameDeps(deps, prevIdentityDepsRef.current)) {
    const cached = fetchEnabled && cacheKey && cache ? cache.get<T>(cacheKey) : undefined;
    const hasCached = cached !== undefined;
    return {
      data: hasCached ? cached : initialData,
      isLoading: fetchEnabled && !hasCached,
      isRefetching: fetchEnabled && hasCached,
      error: null,
      refetch,
    };
  }

  const isLoading = isFetching && !hasDataRef.current;
  const isRefetching = isFetching && hasDataRef.current;

  return { data, isLoading, isRefetching, error, refetch };
}

/** Whether two dependency lists hold the same values, compared as React compares deps. */
function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
}
