"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface FolderEntry {
  readonly name: string;
  readonly isDir: boolean;
  readonly hidden?: boolean;
}

export interface FolderListing {
  readonly path: string;
  readonly cwd: string;
  readonly home: string;
  readonly entries: readonly FolderEntry[];
}

export interface UseFolderListingReturn {
  readonly listing: FolderListing | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Whether the /api/fs/list endpoint is available. Null until first fetch. */
  readonly isAvailable: boolean | null;
  readonly browse: (path: string) => void;
  /** Clears the current error without navigating. */
  readonly clearError: () => void;
}

const MAX_CACHE_SIZE = 32;

/**
 * Data hook that fetches directory listings from the local CLI's
 * filesystem API (`GET /api/fs/list`).
 *
 * This hook fetches from a same-origin HTTP endpoint — not gRPC — because
 * the filesystem listing is a local-only utility outside the domain API
 * surface. The endpoint only exists on the Go CLI's web console server.
 *
 * Provides in-memory caching of recent listings for fast back-navigation,
 * and an `isAvailable` flag that detects whether the endpoint exists
 * (graceful degradation when running against a backend without the endpoint).
 */
export function useFolderListing(
  initialPath?: string,
): UseFolderListingReturn {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  const cacheRef = useRef<Map<string, FolderListing>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const fetchListing = useCallback(async (dirPath?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const cacheKey = dirPath ?? "";
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setListing(cached);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const resp = await fetch(`/api/fs/list${params}`, {
        signal: controller.signal,
      });

      if (!resp.ok) {
        if (resp.status === 404 && !dirPath) {
          setIsAvailable(false);
          setError("Folder browser not available");
          return;
        }
        const body = await resp.json().catch(() => null);
        const msg =
          (body as { error?: string } | null)?.error ?? `Error ${resp.status}`;
        setError(msg);
        return;
      }

      setIsAvailable(true);
      const data: FolderListing = await resp.json();
      setListing(data);
      setError(null);

      const cache = cacheRef.current;
      cache.set(data.path, data);
      if (cache.size > MAX_CACHE_SIZE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError("Failed to load directory");
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchListing(initialPath);
    return () => abortRef.current?.abort();
  }, [initialPath, fetchListing]);

  const browse = useCallback(
    (path: string) => {
      fetchListing(path);
    },
    [fetchListing],
  );

  const clearError = useCallback(() => setError(null), []);

  return { listing, isLoading, error, isAvailable, browse, clearError };
}
