import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStigmer } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface OrgContextValue {
  /** All organizations the authenticated user belongs to. */
  readonly orgs: Organization[];
  /** The currently selected organization. Null while loading or if the user has no orgs. */
  readonly activeOrg: Organization | null;
  /** Switch the active organization. Persisted to localStorage. */
  readonly setActiveOrg: (org: Organization) => void;
  /** True during the initial fetch of organizations. */
  readonly isLoading: boolean;
  /** Non-null when the fetch failed. */
  readonly error: string | null;
  /** Re-attempt the organization fetch after a failure. */
  readonly retry: () => void;
  /**
   * Refetch the organization list. If `targetSlug` is provided, the
   * org matching that slug will be auto-selected after the fetch
   * completes (useful after creating a new organization).
   */
  readonly refresh: (targetSlug?: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "stigmer:activeOrgSlug";

function readPersistedSlug(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSlug(slug: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Private browsing — silently ignore.
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Desktop org provider — fetches the user's organizations and provides
 * org context to the app.
 *
 * Mirrors the web's `OrgProvider` with the same localStorage persistence
 * and auto-select behavior.
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const stigmer = useStigmer();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrgState] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIdRef = useRef(0);

  const load = useCallback(
    async (targetSlug?: string) => {
      const fetchId = ++fetchIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await stigmer.organization.findMyOrganizations();
        const entries = response.entries;

        if (fetchId !== fetchIdRef.current) return;

        setOrgs(entries);

        if (entries.length === 0) {
          setActiveOrgState(null);
          return;
        }

        const preferred = targetSlug ?? readPersistedSlug();
        const restored = preferred
          ? entries.find((o) => o.metadata?.slug === preferred)
          : undefined;

        const selected = restored ?? entries[0];
        setActiveOrgState(selected);
        if (selected.metadata?.slug) {
          persistSlug(selected.metadata.slug);
        }
      } catch (err: unknown) {
        if (fetchId !== fetchIdRef.current) return;

        const message =
          err instanceof Error ? err.message : "Failed to load organizations";
        setError(message);
        setOrgs([]);
        setActiveOrgState(null);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [stigmer],
  );

  useEffect(() => {
    load();
  }, [load]);

  const setActiveOrg = useCallback((org: Organization) => {
    setActiveOrgState(org);
    if (org.metadata?.slug) {
      persistSlug(org.metadata.slug);
    }
  }, []);

  const value = useMemo<OrgContextValue>(
    () => ({
      orgs,
      activeOrg,
      setActiveOrg,
      isLoading,
      error,
      retry: load,
      refresh: load,
    }),
    [orgs, activeOrg, setActiveOrg, isLoading, error, load],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the active organization context.
 *
 * Throws if called outside `<OrgProvider>`.
 */
export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error("useOrg must be used within <OrgProvider>");
  }
  return ctx;
}

/**
 * Convenience accessor: returns the active org's slug for use in API calls,
 * or an empty string when no org is selected.
 */
export function useActiveOrgSlug(): string {
  const { activeOrg } = useOrg();
  return activeOrg?.metadata?.slug ?? "";
}

/**
 * Full active org object for components that need the metadata.id.
 */
export function useActiveOrg() {
  return useOrg();
}
