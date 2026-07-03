"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { FetchCache, type FetchCacheOptions } from "./fetch-cache.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * @internal Exported for test-level injection — not part of the public API.
 */
export const FetchCacheContext = createContext<FetchCache | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Provides a `FetchCache` instance to descendant `useFetch` hooks.
 *
 * Mount this component **above** any remount boundary (e.g. above a
 * `key`-driven session switch) so that cached data survives when child
 * components unmount and remount. Without this provider, `useFetch`
 * works exactly as before — no cache, no behavior change.
 *
 * @example
 * ```tsx
 * // In your app shell (above the session key boundary):
 * <FetchCacheProvider>
 *   <SessionPageInner key={activeSessionId} id={activeSessionId} />
 * </FetchCacheProvider>
 * ```
 *
 * @example
 * ```tsx
 * // With custom limits:
 * <FetchCacheProvider maxEntries={50} ttl={120_000}>
 *   <App />
 * </FetchCacheProvider>
 * ```
 */
export function FetchCacheProvider({
  children,
  maxEntries,
  ttl,
}: FetchCacheOptions & { children: ReactNode }) {
  const cacheRef = useRef<FetchCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new FetchCache({ maxEntries, ttl });
  }
  return (
    <FetchCacheContext.Provider value={cacheRef.current}>
      {children}
    </FetchCacheContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the nearest `FetchCache` from context.
 *
 * Returns `null` when no `FetchCacheProvider` is mounted — callers
 * must handle the null case gracefully (skip caching).
 *
 * @internal Consumed by `useFetch`; not intended for direct use by
 * SDK consumers.
 */
export function useFetchCache(): FetchCache | null {
  return useContext(FetchCacheContext);
}
