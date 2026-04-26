"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface BreadcrumbOverrideContextValue {
  readonly label: string | null;
  readonly setLabel: (label: string | null) => void;
}

const BreadcrumbOverrideContext =
  createContext<BreadcrumbOverrideContextValue | null>(null);

/**
 * Provides a breadcrumb label override for library detail pages.
 *
 * Wrap the library zone in this provider so that detail pages can push
 * a human-readable resource name into the breadcrumb via
 * `useBreadcrumbOverride().setLabel(name)`.
 */
export function LibraryBreadcrumbProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [label, setLabelState] = useState<string | null>(null);
  const setLabel = useCallback(
    (next: string | null) => setLabelState(next),
    [],
  );
  const value = useMemo(() => ({ label, setLabel }), [label, setLabel]);

  return (
    <BreadcrumbOverrideContext.Provider value={value}>
      {children}
    </BreadcrumbOverrideContext.Provider>
  );
}

/**
 * Read the current breadcrumb override label.
 *
 * Used by breadcrumb UI components to display a resource display name
 * instead of the raw URL slug for the last segment.
 */
export function useBreadcrumbLabel(): string | null {
  return useContext(BreadcrumbOverrideContext)?.label ?? null;
}

/**
 * Set (or clear) the breadcrumb override label.
 *
 * Used by detail pages to push the resource display name up to the
 * breadcrumb after the resource data has loaded. Returns a stable
 * `setLabel` function safe for use as a `useEffect` dependency.
 */
export function useBreadcrumbOverride(): {
  /** Set or clear the breadcrumb label override for the active detail page. */
  setLabel: (label: string | null) => void;
} {
  const ctx = useContext(BreadcrumbOverrideContext);
  const noop = useCallback((_label: string | null) => {}, []);
  return { setLabel: ctx?.setLabel ?? noop };
}
