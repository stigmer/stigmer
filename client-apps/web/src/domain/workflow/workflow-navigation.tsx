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

interface ActiveWorkflowDetail {
  readonly org: string;
  readonly slug: string;
}

interface WorkflowNavigationValue {
  activeDetail: ActiveWorkflowDetail | null;
  currentWorkflowPath: string;
  navigateToDetail: (org: string, slug: string) => void;
  clearDetail: () => void;
}

export type { ActiveWorkflowDetail };

const WorkflowNavigationContext =
  createContext<WorkflowNavigationValue | null>(null);

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const WORKFLOW_DETAIL_RE = /^\/workflows\/([^/]+)\/([^/]+)\/?$/;

function parseWorkflowDetailPath(
  pathname: string,
): ActiveWorkflowDetail | null {
  const match = pathname.match(WORKFLOW_DETAIL_RE);
  if (!match) return null;
  return { org: match[1], slug: match[2] };
}

function isWorkflowPath(pathname: string): boolean {
  return pathname === "/workflows" || pathname.startsWith("/workflows/");
}

function detailToPath(detail: ActiveWorkflowDetail): string {
  return `/workflows/${detail.org}/${detail.slug}`;
}

function detailsEqual(
  a: ActiveWorkflowDetail | null,
  b: ActiveWorkflowDetail | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.org === b.org && a.slug === b.slug;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Client-side workflow router that bypasses Next.js routing for detail
 * page navigation within the /workflows zone.
 *
 * Follows the same pattern as LibraryNavigationProvider -- manages
 * detail-page transitions via React state + `history.pushState`,
 * keeping the layout, breadcrumbs, and list page state fully mounted
 * across transitions.
 */
export function WorkflowNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeDetail, setActiveDetail] =
    useState<ActiveWorkflowDetail | null>(() => {
      if (typeof window === "undefined") return null;
      return parseWorkflowDetailPath(window.location.pathname);
    });

  const nextPathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(nextPathname);
  if (nextPathname !== prevPathname) {
    setPrevPathname(nextPathname);
    if (!isWorkflowPath(nextPathname)) {
      setActiveDetail(null);
    } else if (!parseWorkflowDetailPath(nextPathname)) {
      setActiveDetail(null);
    }
  }

  const activeDetailRef = useRef(activeDetail);
  useEffect(() => {
    activeDetailRef.current = activeDetail;
  }, [activeDetail]);

  const navigateToDetail = useCallback((org: string, slug: string) => {
    const next: ActiveWorkflowDetail = { org, slug };
    if (!detailsEqual(activeDetailRef.current, next)) {
      setActiveDetail(next);
      window.history.pushState(null, "", detailToPath(next));
    }
  }, []);

  const clearDetail = useCallback(() => {
    if (activeDetailRef.current) {
      setActiveDetail(null);
      window.history.pushState(null, "", "/workflows");
    }
  }, []);

  useEffect(() => {
    function handlePopState() {
      const pathname = window.location.pathname;
      if (isWorkflowPath(pathname)) {
        setActiveDetail(parseWorkflowDetailPath(pathname));
      } else {
        setActiveDetail(null);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const currentWorkflowPath = activeDetail
    ? detailToPath(activeDetail)
    : nextPathname;

  const value = useMemo<WorkflowNavigationValue>(
    () => ({
      activeDetail,
      currentWorkflowPath,
      navigateToDetail,
      clearDetail,
    }),
    [activeDetail, currentWorkflowPath, navigateToDetail, clearDetail],
  );

  return (
    <WorkflowNavigationContext.Provider value={value}>
      {children}
    </WorkflowNavigationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWorkflowNavigation(): WorkflowNavigationValue {
  const ctx = useContext(WorkflowNavigationContext);
  if (!ctx) {
    throw new Error(
      "useWorkflowNavigation must be used within <WorkflowNavigationProvider>",
    );
  }
  return ctx;
}
