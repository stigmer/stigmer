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
// Types
// ---------------------------------------------------------------------------

type LibraryResourceType =
  | "agents"
  | "skills"
  | "mcp-servers"
  | "workflows"
  | "datastores"
  | "schedules";

interface ActiveDetail {
  readonly resourceType: LibraryResourceType;
  readonly org: string;
  readonly slug: string;
}

interface LibraryNavigationValue {
  /** The detail page currently being viewed, or null when on a list/landing page. */
  activeDetail: ActiveDetail | null;
  /** The current library path — either the real pathname or the virtual pushState path. */
  currentLibraryPath: string;
  /** Navigate to a resource detail page without a full page reload. */
  navigateToDetail: (
    resourceType: LibraryResourceType,
    org: string,
    slug: string,
  ) => void;
  /** Clear the active detail, returning to the underlying list page. */
  clearDetail: () => void;
}

export type { ActiveDetail, LibraryResourceType };

const LibraryNavigationContext = createContext<LibraryNavigationValue | null>(
  null,
);

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const LIBRARY_DETAIL_RE =
  /^\/library\/(agents|skills|mcp-servers|workflows|datastores|schedules)\/([^/]+)\/([^/]+)\/?$/;

function parseLibraryDetailPath(pathname: string): ActiveDetail | null {
  const match = pathname.match(LIBRARY_DETAIL_RE);
  if (!match) return null;
  return {
    resourceType: match[1] as LibraryResourceType,
    org: match[2],
    slug: match[3],
  };
}

function isLibraryPath(pathname: string): boolean {
  return pathname === "/library" || pathname.startsWith("/library/");
}

function detailToPath(detail: ActiveDetail): string {
  return `/library/${detail.resourceType}/${detail.org}/${detail.slug}`;
}

function detailsEqual(a: ActiveDetail | null, b: ActiveDetail | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.resourceType === b.resourceType && a.org === b.org && a.slug === b.slug
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Client-side library router that bypasses Next.js routing for detail
 * page navigation within the library zone.
 *
 * In static-export mode, Next.js cannot soft-navigate to dynamic routes
 * (`/library/agents/[org]/[slug]`) that were not pre-rendered. This
 * provider manages detail-page transitions via React state +
 * `history.pushState`, keeping the library layout, breadcrumbs, and
 * list page state fully mounted across transitions.
 *
 * Static library routes (`/library`, `/library/agents`, etc.) continue
 * to use Next.js `<Link>` routing normally. When Next.js navigates away
 * from the library zone, the provider clears detail state automatically.
 */
export function LibraryNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeDetail, setActiveDetail] = useState<ActiveDetail | null>(() => {
    if (typeof window === "undefined") return null;
    return parseLibraryDetailPath(window.location.pathname);
  });

  // Track Next.js router navigations (e.g. <Link> to /) that bypass
  // pushState. When the Next.js pathname leaves the library zone we
  // clear detail state. Adjusting state during render avoids cascading
  // effect re-renders.
  const nextPathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(nextPathname);
  if (nextPathname !== prevPathname) {
    setPrevPathname(nextPathname);
    if (!isLibraryPath(nextPathname)) {
      setActiveDetail(null);
    } else if (!parseLibraryDetailPath(nextPathname)) {
      // Next.js navigated to a list-level library path (e.g. breadcrumb
      // <Link> to /library/agents); clear the active detail so the
      // list page renders.
      setActiveDetail(null);
    }
  }

  const activeDetailRef = useRef(activeDetail);
  useEffect(() => {
    activeDetailRef.current = activeDetail;
  }, [activeDetail]);

  const navigateToDetail = useCallback(
    (resourceType: LibraryResourceType, org: string, slug: string) => {
      const next: ActiveDetail = { resourceType, org, slug };
      if (!detailsEqual(activeDetailRef.current, next)) {
        setActiveDetail(next);
        window.history.pushState(null, "", detailToPath(next));
      }
    },
    [],
  );

  const clearDetail = useCallback(() => {
    if (activeDetailRef.current) {
      const listPath = `/library/${activeDetailRef.current.resourceType}`;
      setActiveDetail(null);
      window.history.pushState(null, "", listPath);
    }
  }, []);

  // Sync state when the user navigates with browser back/forward buttons.
  useEffect(() => {
    function handlePopState() {
      const pathname = window.location.pathname;
      if (isLibraryPath(pathname)) {
        setActiveDetail(parseLibraryDetailPath(pathname));
      } else {
        setActiveDetail(null);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const currentLibraryPath = activeDetail
    ? detailToPath(activeDetail)
    : nextPathname;

  const value = useMemo<LibraryNavigationValue>(
    () => ({
      activeDetail,
      currentLibraryPath,
      navigateToDetail,
      clearDetail,
    }),
    [activeDetail, currentLibraryPath, navigateToDetail, clearDetail],
  );

  return (
    <LibraryNavigationContext.Provider value={value}>
      {children}
    </LibraryNavigationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the library navigation context.
 *
 * Throws if called outside `<LibraryNavigationProvider>` — this surfaces
 * wiring mistakes immediately during development.
 */
export function useLibraryNavigation(): LibraryNavigationValue {
  const ctx = useContext(LibraryNavigationContext);
  if (!ctx) {
    throw new Error(
      "useLibraryNavigation must be used within <LibraryNavigationProvider>",
    );
  }
  return ctx;
}
