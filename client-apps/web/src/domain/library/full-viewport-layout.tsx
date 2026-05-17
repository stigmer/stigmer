"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface FullViewportLayoutValue {
  /** Whether the layout should expand to full viewport width. */
  readonly isFullViewport: boolean;
  /** Request full-viewport mode. Call on mount and pass `false` on unmount. */
  readonly setFullViewport: (active: boolean) => void;
}

const FullViewportLayoutContext =
  createContext<FullViewportLayoutValue | null>(null);

/**
 * Provides the ability for child pages to request full-viewport layout,
 * bypassing the `max-w-4xl` constraint that the library zone applies.
 *
 * Used by the workflow visual editor which needs the full canvas width
 * to render the task palette, React Flow canvas, and inspector panel.
 */
export function FullViewportLayoutProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isFullViewport, setIsFullViewport] = useState(false);

  const setFullViewport = useCallback((active: boolean) => {
    setIsFullViewport(active);
  }, []);

  const value = useMemo<FullViewportLayoutValue>(
    () => ({ isFullViewport, setFullViewport }),
    [isFullViewport, setFullViewport],
  );

  return (
    <FullViewportLayoutContext.Provider value={value}>
      {children}
    </FullViewportLayoutContext.Provider>
  );
}

/**
 * Access the full-viewport layout context.
 *
 * Throws if called outside `<FullViewportLayoutProvider>`.
 */
export function useFullViewportLayout(): FullViewportLayoutValue {
  const ctx = useContext(FullViewportLayoutContext);
  if (!ctx) {
    throw new Error(
      "useFullViewportLayout must be used within <FullViewportLayoutProvider>",
    );
  }
  return ctx;
}

/**
 * Declarative hook that activates full-viewport layout while the
 * calling component is mounted.
 *
 * Automatically cleans up on unmount so the layout returns to normal
 * when navigating away from the visual editor.
 */
export function useRequestFullViewport(active: boolean): void {
  const { setFullViewport } = useFullViewportLayout();

  useEffect(() => {
    setFullViewport(active);
    return () => setFullViewport(false);
  }, [active, setFullViewport]);
}
