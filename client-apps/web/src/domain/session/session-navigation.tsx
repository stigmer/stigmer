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
import { useAppNavigation } from "@/domain/_shared/navigation/app-navigation";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface SessionNavigationValue {
  /** The session currently being viewed, or null when on the new-session screen. */
  activeSessionId: string | null;
  /** True when the app is in the "session zone" (home or session view). */
  isSessionZone: boolean;
  /**
   * The last pathname the user was on inside the session zone, captured
   * when they navigated away (e.g. to `/settings`). Consumers like
   * ManagementSidebar use this to send the user back to where they were
   * rather than always landing on `/`.
   */
  lastSessionZonePath: string | null;
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

/** True for the session zone: the home screen or a specific session view. */
export function isSessionZonePath(pathname: string): boolean {
  return pathname === "/" || SESSION_PATH_RE.test(pathname);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Session zone navigation, derived from the app-level navigation source of
 * truth (`useAppNavigation`).
 *
 * Session switching is a thin layer over the shared `currentPath` + `navigate`
 * primitive: the zone flags and active session id are pure derivations of the
 * current path, and `navigateToSession` / `navigateToHome` delegate to the
 * shared `navigate`. The only session-specific state owned here is
 * `lastSessionZonePath`, which powers "Back to Sessions" from the management
 * zone.
 *
 * Non-session routes (e.g. `/library`) continue to use Next.js routing; the
 * shared provider adopts those navigations into `currentPath`, and this layer
 * simply observes that the path left the session zone.
 */
export function SessionNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentPath, navigate } = useAppNavigation();

  const isSessionZone = isSessionZonePath(currentPath);
  const activeSessionId = isSessionZone ? sessionIdFromPath(currentPath) : null;

  // Snapshot of the last session-zone pathname, captured when the user leaves
  // the zone. "Back to Sessions" uses this to return the user to where they
  // were rather than always landing on `/`.
  const [lastSessionZonePath, setLastSessionZonePath] = useState<string | null>(
    null,
  );
  const prevPathRef = useRef(currentPath);
  useEffect(() => {
    const prev = prevPathRef.current;
    if (isSessionZonePath(prev) && !isSessionZonePath(currentPath)) {
      setLastSessionZonePath(prev);
    }
    prevPathRef.current = currentPath;
  }, [currentPath]);

  const navigateToSession = useCallback(
    (id: string) => {
      navigate(`/sessions/${id}`);
    },
    [navigate],
  );

  const navigateToHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const value = useMemo<SessionNavigationValue>(
    () => ({
      activeSessionId,
      isSessionZone,
      lastSessionZonePath,
      navigateToSession,
      navigateToHome,
    }),
    [
      activeSessionId,
      isSessionZone,
      lastSessionZonePath,
      navigateToSession,
      navigateToHome,
    ],
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
