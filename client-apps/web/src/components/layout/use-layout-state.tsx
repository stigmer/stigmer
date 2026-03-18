"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

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

// ---------------------------------------------------------------------------
// Context panel slot — lets pages inject content into the layout-level panel
// ---------------------------------------------------------------------------

interface ContextPanelSlotState {
  readonly content: ReactNode | null;
  readonly setContent: (content: ReactNode | null) => void;
}

const ContextPanelSlotContext = createContext<ContextPanelSlotState | null>(
  null,
);

export function ContextPanelSlotProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [content, setContent] = useState<ReactNode | null>(null);

  const value = useMemo(
    () => ({ content, setContent }),
    [content],
  );

  return (
    <ContextPanelSlotContext.Provider value={value}>
      {children}
    </ContextPanelSlotContext.Provider>
  );
}

/**
 * Registers content to display in the layout-level context panel.
 *
 * Call from any page rendered inside `AppShell`. The content is
 * automatically cleared when the calling component unmounts.
 */
export function useContextPanelSlot(content: ReactNode | null): void {
  const ctx = useContext(ContextPanelSlotContext);
  if (!ctx) {
    throw new Error(
      "useContextPanelSlot must be used within ContextPanelSlotProvider — " +
        "ensure AppShell wraps this component tree.",
    );
  }

  useEffect(() => {
    ctx.setContent(content);
    return () => ctx.setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);
}

/**
 * Reads the current context panel slot content. Used by `ContextPanel`
 * to render whatever the active page has registered.
 */
export function useContextPanelSlotContent(): ReactNode | null {
  const ctx = useContext(ContextPanelSlotContext);
  return ctx?.content ?? null;
}
