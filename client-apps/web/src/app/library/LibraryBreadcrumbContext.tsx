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
  /** Override label for the last breadcrumb segment, or `null` to use the raw URL segment. */
  readonly label: string | null;
  /** Set (or clear) the override label for the last breadcrumb segment. */
  readonly setLabel: (label: string | null) => void;
}

const BreadcrumbOverrideContext =
  createContext<BreadcrumbOverrideContextValue | null>(null);

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
 * Used by `LibraryBreadcrumb` to display a resource display name
 * instead of the raw URL slug.
 */
export function useBreadcrumbLabel(): string | null {
  return useContext(BreadcrumbOverrideContext)?.label ?? null;
}

/**
 * Set (or clear) the breadcrumb override label.
 * Used by detail pages to push the resource display name up to the
 * breadcrumb after the resource data has loaded.
 *
 * Returns a stable `setLabel` function safe for use as a `useEffect`
 * dependency.
 */
export function useBreadcrumbOverride(): {
  setLabel: (label: string | null) => void;
} {
  const ctx = useContext(BreadcrumbOverrideContext);
  const noop = useCallback((_label: string | null) => {}, []);
  return { setLabel: ctx?.setLabel ?? noop };
}
