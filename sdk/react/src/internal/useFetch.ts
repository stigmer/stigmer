"use client";

import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { toError } from "./toError";

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
 *
 * @param fetchFn  Async function that returns data, or `null` to skip.
 * @param deps     Dependency list — a new fetch fires when any dep changes.
 * @param initialData  Value returned before the first successful fetch.
 * @param options  Optional configuration (e.g. polling interval).
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
export function useFetch<T>(
  fetchFn: (() => Promise<T>) | null,
  deps: DependencyList,
  initialData: T,
  options?: UseFetchOptions,
): UseFetchReturn<T> {
  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const hasDataRef = useRef(false);
  const isFetchingRef = useRef(false);
  const [isFetching, setIsFetching] = useState(false);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!fetchFn) {
      setData(initialData);
      setIsFetching(false);
      isFetchingRef.current = false;
      setError(null);
      hasDataRef.current = false;
      return;
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

  const refetchInterval = options?.refetchInterval;
  useEffect(() => {
    if (!refetchInterval || refetchInterval <= 0 || !fetchFn) return;
    const id = setInterval(() => {
      if (!isFetchingRef.current) refetch();
    }, refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval, fetchFn, refetch]);

  const isLoading = isFetching && !hasDataRef.current;
  const isRefetching = isFetching && hasDataRef.current;

  return { data, isLoading, isRefetching, error, refetch };
}
