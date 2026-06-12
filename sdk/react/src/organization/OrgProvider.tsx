"use client";

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
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useStigmer } from "../hooks";

/** Value exposed by {@link OrgProvider} via {@link useOrg}. */
export interface OrgContextValue {
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
    // SSR or private browsing — silently ignore.
  }
}

/**
 * Provides organization context to the component tree.
 *
 * Fetches the authenticated user's organizations via
 * `stigmer.organization.findMyOrganizations()`, manages the active
 * organization selection, and persists the choice to `localStorage`
 * under the key `stigmer:activeOrgSlug`.
 *
 * Must be rendered inside a {@link StigmerProvider}.
 *
 * @example
 * ```tsx
 * <StigmerProvider client={client}>
 *   <OrgProvider>
 *     <App />
 *   </OrgProvider>
 * </StigmerProvider>
 * ```
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

/**
 * Access the active organization context from the nearest
 * {@link OrgProvider}.
 *
 * Throws if called outside an `<OrgProvider>` — this surfaces wiring
 * mistakes immediately during development.
 */
export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error(
      "useOrg must be used within <OrgProvider>. " +
        "Wrap your component tree with <OrgProvider> inside a <StigmerProvider>.",
    );
  }
  return ctx;
}

/**
 * Convenience accessor: returns the active org's slug for use in API
 * calls, or an empty string when no org is selected.
 */
export function useActiveOrgSlug(): string {
  const { activeOrg } = useOrg();
  return activeOrg?.metadata?.slug ?? "";
}

/**
 * Convenience accessor: returns the active org's system ID (`metadata.id`),
 * or an empty string when no org is selected.
 *
 * This is the identifier used as the `organization` object in authorization
 * (FGA) — e.g. for member lookups in the share picker — as opposed to the
 * human-readable slug returned by {@link useActiveOrgSlug}.
 */
export function useActiveOrgId(): string {
  const { activeOrg } = useOrg();
  return activeOrg?.metadata?.id ?? "";
}
