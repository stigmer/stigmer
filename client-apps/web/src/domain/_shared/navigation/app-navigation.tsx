"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface AppNavigationValue {
  /**
   * The current in-app path. This is the single source of truth for
   * client-side navigation across the app shell — session zone, execution
   * zone, and any future dynamic detail route derive their state from it.
   */
  currentPath: string;
  /**
   * Navigate to a path via `history.pushState`, without a full document
   * reload. Keeps the entire React tree (providers, sidebar, SDK client)
   * mounted across transitions.
   */
  navigate: (path: string) => void;
}

const AppNavigationContext = createContext<AppNavigationValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function initialPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
}

/**
 * App-level client navigation provider — the single source of truth for the
 * current in-app path under static export.
 *
 * In static-export mode, Next.js cannot soft-navigate to dynamic routes that
 * were not pre-rendered (e.g. `/sessions/<id>`, `/executions/<id>`). Rather
 * than reload the document on every such transition, this provider tracks the
 * current path entirely via React state + `history.pushState`.
 *
 * Domain-specific navigation concerns layer on top of this primitive as thin
 * consumers (`useSessionNavigation`, `useExecutionNavigation`). Keeping a
 * single `currentPath` here — rather than one `pushState` provider per zone —
 * is a correctness requirement: `usePathname()` does not fire on manual
 * `pushState`, so independent providers could not observe each other's
 * transitions and their derived zone state would drift out of sync with the
 * URL. One source of truth makes the zones mutually consistent by
 * construction.
 */
export function AppNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentPath, setCurrentPath] = useState<string>(initialPath);

  const currentPathRef = useRef(currentPath);
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  // Adopt genuine Next.js navigations (e.g. a <Link> to `/library` or
  // `/settings`) as the new source of truth. `usePathname()` reflects only
  // Next.js routing — it does NOT update on `history.pushState` — so we
  // detect a real Next navigation by comparing against the previous value.
  // `prevNextPathname` is seeded equal to `nextPathname`, so this block never
  // fires on the initial render and cannot clobber a deep-linked path with a
  // static-export placeholder. Adjusting state during render (instead of in an
  // effect) keeps `currentPath` consistent within the same commit.
  const nextPathname = usePathname();
  const [prevNextPathname, setPrevNextPathname] = useState(nextPathname);
  if (nextPathname !== prevNextPathname) {
    setPrevNextPathname(nextPathname);
    if (nextPathname !== currentPath) {
      setCurrentPath(nextPathname);
    }
  }

  const navigate = useCallback((path: string) => {
    if (path === currentPathRef.current) return;
    setCurrentPath(path);
    window.history.pushState(null, "", path);
  }, []);

  // Sync state when the user navigates with the browser back/forward buttons.
  useEffect(() => {
    function handlePopState() {
      setCurrentPath(window.location.pathname);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const value = useMemo<AppNavigationValue>(
    () => ({ currentPath, navigate }),
    [currentPath, navigate],
  );

  return (
    <AppNavigationContext.Provider value={value}>
      {children}
    </AppNavigationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the app navigation source of truth.
 *
 * Throws if called outside `<AppNavigationProvider>` — this surfaces wiring
 * mistakes immediately during development.
 */
export function useAppNavigation(): AppNavigationValue {
  const ctx = useContext(AppNavigationContext);
  if (!ctx) {
    throw new Error(
      "useAppNavigation must be used within <AppNavigationProvider>",
    );
  }
  return ctx;
}
