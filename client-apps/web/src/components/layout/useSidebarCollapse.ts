"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "stigmer:sidebar-collapsed";

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  function handleStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) callback();
  }
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

/**
 * Manages sidebar collapsed/expanded state with localStorage persistence.
 *
 * Uses `useSyncExternalStore` to read from localStorage without triggering
 * cascading renders. Server-side returns `false` (expanded) to match the
 * initial client render.
 */
export function useSidebarCollapse() {
  const isCollapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable
    }
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  return { isCollapsed, toggle } as const;
}
