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
import { useStigmer } from "../hooks.js";
import { useFetchCache } from "../internal/FetchCacheProvider.js";

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
   * Refetch the organization list. If `target` is provided, the org it
   * names — by id or by slug — is selected after the fetch completes
   * (useful after creating or renaming an organization).
   */
  readonly refresh: (target?: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

// The active org is remembered by its id: an id never changes, while a
// slug can be renamed and would then restore nothing.
const STORAGE_KEY = "stigmer:activeOrg";
// Where earlier releases remembered the active org, by slug. Read once, when
// no id is remembered yet, so an upgrade keeps the person's choice; the first
// id persisted removes it.
const LEGACY_SLUG_STORAGE_KEY = "stigmer:activeOrgSlug";

/**
 * The remembered org: its id, or the slug an earlier release remembered.
 * An empty value remembers nothing, so it falls through like an absent one.
 */
function readPersistedOrgRef(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistOrgId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.removeItem(LEGACY_SLUG_STORAGE_KEY);
  } catch {
    // SSR or private browsing — silently ignore.
  }
}

/**
 * Find the org a reference names. A reference is an id or a slug; ids and
 * slugs are each unique, so an id match is tried first and a slug match
 * second (an older organization's id equals its slug, which either match
 * answers the same).
 */
export function findOrgByRef(
  orgs: readonly Organization[],
  ref: string,
): Organization | undefined {
  if (!ref) return undefined;
  return (
    orgs.find((o) => o.metadata?.id === ref) ??
    orgs.find((o) => o.metadata?.slug === ref)
  );
}

/**
 * Provides organization context to the component tree.
 *
 * Fetches the authenticated user's organizations via
 * `stigmer.organization.findMyOrganizations()`, manages the active
 * organization selection, and persists the choice to `localStorage`
 * under the key `stigmer:activeOrg` by the organization's id.
 *
 * Must be rendered inside a {@link StigmerProvider}. Mount it BELOW
 * `FetchCacheProvider` (when one is used): switching the active org clears
 * the nearest fetch cache, so view state cached under the previous org
 * context — session and run entries are keyed by id, not org — can
 * never bleed into the new one. Navigation on switch stays the host's
 * responsibility via `OrgSwitcher`'s `onOrgChanged` callback.
 *
 * @example
 * ```tsx
 * <StigmerProvider client={client}>
 *   <FetchCacheProvider>
 *     <OrgProvider>
 *       <App />
 *     </OrgProvider>
 *   </FetchCacheProvider>
 * </StigmerProvider>
 * ```
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const stigmer = useStigmer();
  const fetchCache = useFetchCache();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrgState] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIdRef = useRef(0);

  const load = useCallback(
    async (target?: string) => {
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

        const preferred = target ?? readPersistedOrgRef();
        const restored = preferred
          ? findOrgByRef(entries, preferred)
          : undefined;

        const selected = restored ?? entries[0];
        setActiveOrgState(selected);
        if (selected.metadata?.id) {
          persistOrgId(selected.metadata.id);
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
    if (org.metadata?.id) {
      persistOrgId(org.metadata.id);
    }
  }, []);

  // Org-switch invariant: view state cached under one org context must not
  // survive into another. Covers every path that changes the active org
  // (explicit switch, post-create refresh) while skipping the initial
  // restore (previous id is null). Keyed on the id, so renaming the active
  // org is not a switch. Cache keys for sessions/executions are id-scoped,
  // not org-scoped, so a TTL'd entry would otherwise outlive the switch.
  // No-op when no FetchCacheProvider is mounted.
  const previousIdRef = useRef<string | null>(null);
  const activeId = activeOrg?.metadata?.id ?? null;
  useEffect(() => {
    const previous = previousIdRef.current;
    previousIdRef.current = activeId;
    if (previous !== null && activeId !== null && previous !== activeId) {
      fetchCache?.clear();
    }
  }, [activeId, fetchCache]);

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
 * The org context from the nearest {@link OrgProvider}, or `null` when none
 * is mounted. For SDK helpers that work with or without the provider.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
export function useOptionalOrg(): OrgContextValue | null {
  return useContext(OrgContext);
}

/**
 * Convenience accessor: returns the active org's slug for display text and
 * URLs, or an empty string when no org is selected. A request names the
 * org by id ({@link useActiveOrgId}): the slug can be renamed.
 */
export function useActiveOrgSlug(): string {
  const { activeOrg } = useOrg();
  return activeOrg?.metadata?.slug ?? "";
}

/**
 * Convenience accessor: returns the active org's system ID (`metadata.id`),
 * or an empty string when no org is selected.
 *
 * Every request field that names the active org (`org`, `metadata.org`, a
 * reference's `org`) carries this id, and stored resources name their org
 * by it, so comparisons against `metadata.org` use it too. It never
 * changes, unlike the human-readable slug returned by
 * {@link useActiveOrgSlug}, which is for display and URLs.
 */
export function useActiveOrgId(): string {
  const { activeOrg } = useOrg();
  return activeOrg?.metadata?.id ?? "";
}
