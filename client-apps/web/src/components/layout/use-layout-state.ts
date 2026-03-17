"use client";

import { useCallback, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Sidebar visibility — persisted to localStorage, syncs across tabs
// ---------------------------------------------------------------------------

const SIDEBAR_KEY = "stigmer:sidebar-open";

function getSidebarSnapshot(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === null) return true;
    return stored !== "false";
  } catch {
    return true;
  }
}

function getSidebarServerSnapshot(): boolean {
  return true;
}

function subscribeSidebar(callback: () => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === SIDEBAR_KEY) callback();
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function setSidebarValue(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(open));
  } catch {
    /* SSR or private browsing */
  }
  window.dispatchEvent(new StorageEvent("storage", { key: SIDEBAR_KEY }));
}

export function useSidebarOpen() {
  const isOpen = useSyncExternalStore(
    subscribeSidebar,
    getSidebarSnapshot,
    getSidebarServerSnapshot,
  );

  const toggle = useCallback(() => setSidebarValue(!getSidebarSnapshot()), []);
  const open = useCallback(() => setSidebarValue(true), []);
  const close = useCallback(() => setSidebarValue(false), []);

  return { isOpen, toggle, open, close } as const;
}

// ---------------------------------------------------------------------------
// Context panel visibility — session-scoped (not persisted), no cross-tab sync
// ---------------------------------------------------------------------------

let contextPanelOpen = false;
const contextPanelListeners = new Set<() => void>();

function getContextPanelSnapshot(): boolean {
  return contextPanelOpen;
}

function getContextPanelServerSnapshot(): boolean {
  return false;
}

function subscribeContextPanel(callback: () => void): () => void {
  contextPanelListeners.add(callback);
  return () => contextPanelListeners.delete(callback);
}

function setContextPanelValue(open: boolean): void {
  contextPanelOpen = open;
  contextPanelListeners.forEach((cb) => cb());
}

export function useContextPanelOpen() {
  const isOpen = useSyncExternalStore(
    subscribeContextPanel,
    getContextPanelSnapshot,
    getContextPanelServerSnapshot,
  );

  const toggle = useCallback(
    () => setContextPanelValue(!getContextPanelSnapshot()),
    [],
  );
  const open = useCallback(() => setContextPanelValue(true), []);
  const close = useCallback(() => setContextPanelValue(false), []);

  return { isOpen, toggle, open, close } as const;
}
