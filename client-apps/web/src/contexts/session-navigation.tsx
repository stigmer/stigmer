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

interface SessionNavigationValue {
  /** The session currently being viewed, or null when on the new-session screen. */
  activeSessionId: string | null;
  /** True when the app is in the "session zone" (home or session view). */
  isSessionZone: boolean;
  /** Navigate to an existing session without a full page reload. */
  navigateToSession: (id: string) => void;
  /** Navigate to the new-session screen without a full page reload. */
  navigateToHome: () => void;
}

const SessionNavigationContext = createContext<SessionNavigationValue | null>(
  null,
);

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const SESSION_PATH_RE = /^\/sessions\/(.+)/;

function sessionIdFromPath(pathname: string): string | null {
  return pathname.match(SESSION_PATH_RE)?.[1] ?? null;
}

function isSessionZonePath(pathname: string): boolean {
  return pathname === "/" || SESSION_PATH_RE.test(pathname);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Client-side session router that bypasses Next.js routing for session
 * navigation.
 *
 * In static-export mode, Next.js cannot soft-navigate to dynamic routes
 * that were not pre-rendered. This provider manages session switching
 * entirely via React state + `history.pushState`, keeping the entire
 * React tree (providers, sidebar, SDK client) mounted across transitions.
 *
 * Non-session routes (e.g. `/library`) continue to use Next.js routing.
 * When Next.js navigates to such a route (via `<Link>`), the provider
 * detects the pathname change and exits the session zone automatically.
 */
export function SessionNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionIdFromPath(window.location.pathname);
  });

  const [isSessionZone, setIsSessionZone] = useState(() => {
    if (typeof window === "undefined") return true;
    return isSessionZonePath(window.location.pathname);
  });

  // Track Next.js router navigations (e.g. <Link> to /library) that
  // bypass pushState. When the Next.js pathname leaves the session
  // zone we clear the session state so AppShell renders {children}.
  // Adjusting state during render avoids cascading effect re-renders.
  const nextPathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(nextPathname);
  if (nextPathname !== prevPathname) {
    setPrevPathname(nextPathname);
    if (!isSessionZonePath(nextPathname)) {
      setIsSessionZone(false);
      setActiveSessionId(null);
    }
  }

  // Avoid re-creating callbacks when session ID changes.
  const sessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const navigateToSession = useCallback((id: string) => {
    const path = `/sessions/${id}`;
    if (sessionIdRef.current !== id) {
      setActiveSessionId(id);
      setIsSessionZone(true);
      window.history.pushState(null, "", path);
    }
  }, []);

  const navigateToHome = useCallback(() => {
    if (sessionIdRef.current !== null) {
      setActiveSessionId(null);
      setIsSessionZone(true);
      window.history.pushState(null, "", "/");
    }
  }, []);

  // Sync state when the user navigates with browser back/forward buttons.
  useEffect(() => {
    function handlePopState() {
      const pathname = window.location.pathname;
      setActiveSessionId(sessionIdFromPath(pathname));
      setIsSessionZone(isSessionZonePath(pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const value = useMemo<SessionNavigationValue>(
    () => ({
      activeSessionId,
      isSessionZone,
      navigateToSession,
      navigateToHome,
    }),
    [activeSessionId, isSessionZone, navigateToSession, navigateToHome],
  );

  return (
    <SessionNavigationContext.Provider value={value}>
      {children}
    </SessionNavigationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the session navigation context.
 *
 * Throws if called outside `<SessionNavigationProvider>` — this surfaces
 * wiring mistakes immediately during development.
 */
export function useSessionNavigation(): SessionNavigationValue {
  const ctx = useContext(SessionNavigationContext);
  if (!ctx) {
    throw new Error(
      "useSessionNavigation must be used within <SessionNavigationProvider>",
    );
  }
  return ctx;
}
