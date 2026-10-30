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
import { create } from "@bufbuild/protobuf";
import { isNotFound, isPermissionDenied } from "@stigmer/client";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ListMyOrganizationsInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { useFetchCache } from "@stigmer/react-core/internal";
import { LIST_PAGE_MAX, readEveryPage } from "@stigmer/react-core/internal";

/** Value exposed by {@link OrgProvider} via {@link useOrg}. */
export interface OrgContextValue {
  /** All organizations the authenticated user belongs to. */
  readonly orgs: Organization[];
  /**
   * The currently selected organization. Null while loading or if the user
   * has no orgs.
   *
   * Usually one of `orgs`, but it may be an organization outside them that
   * the person opened and can read: a child organization its parent's
   * admin opened from the parent's Child organizations list. Such an
   * organization is never added to `orgs`.
   */
  readonly activeOrg: Organization | null;
  /**
   * Switch the active organization: one of `orgs`, or any organization the
   * person can read. Persisted to localStorage, and restored on the next
   * load while the person can still read it.
   */
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
   * (useful after creating or renaming an organization), read from the
   * server when it is not one of `orgs`, as a remembered one is.
   */
  readonly refresh: (target?: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

// The active org is remembered by its id: an id never changes, while a
// slug can be renamed and would then restore nothing.
const STORAGE_KEY = "stigmer:activeOrg";

/**
 * The remembered org's id. An empty value remembers nothing, so it falls
 * through like an absent one.
 */
function readPersistedOrgId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function persistOrgId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // SSR or private browsing — silently ignore.
  }
}

/**
 * Find the org a reference names. A reference is an id or a slug; ids and
 * slugs are each unique, so an id match is tried first and a slug match
 * second.
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
 * The organizations the console can name by id or slug: the person's own,
 * plus the active one when it is outside them (an organization the person
 * opened, see {@link OrgContextValue.activeOrg}). Answers `orgs` itself when
 * nothing is added.
 */
function knownOrgs(
  orgs: readonly Organization[],
  activeOrg: Organization | null,
): readonly Organization[] {
  const id = activeOrg?.metadata?.id;
  if (!activeOrg || !id || orgs.some((o) => o.metadata?.id === id)) return orgs;
  return [...orgs, activeOrg];
}

/**
 * Provides organization context to the component tree.
 *
 * Fetches the authenticated user's organizations via
 * `stigmer.organization.listMine()` (every page), manages the active
 * organization selection, and persists the choice to `localStorage`
 * under the key `stigmer:activeOrg` by the organization's id.
 *
 * The active organization may be one outside that list which the person
 * can read: a parent organization's admins are admins in each of its
 * children without belonging to them, and open one from the parent's
 * Child organizations list. A remembered (or `refresh`-named) organization
 * the list does not hold is read once with `stigmer.organization.get()`:
 * answered, it stays active; refused (the person can no longer read it,
 * or it is gone), the first listed organization is selected; any other
 * failure is the provider's `error`, so the person is never moved quietly
 * into another organization.
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

  // An organization outside the person's list, read by reference: the
  // answer, or undefined when the server refuses it (not found also
  // answers an organization being deleted). Any other failure throws.
  const readOpenedOrg = useCallback(
    async (ref: string): Promise<Organization | undefined> => {
      try {
        return await stigmer.organization.get(ref);
      } catch (err: unknown) {
        if (isNotFound(err) || isPermissionDenied(err)) return undefined;
        throw err;
      }
    },
    [stigmer],
  );

  const load = useCallback(
    async (target?: string) => {
      const fetchId = ++fetchIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        // The switcher offers every organization the caller is in, so the
        // provider walks every page of the list.
        const entries = await readEveryPage((pageToken) =>
          stigmer.organization.listMine(
            create(ListMyOrganizationsInputSchema, { pageSize: LIST_PAGE_MAX, pageToken }),
          ),
        );

        if (fetchId !== fetchIdRef.current) return;

        if (entries.length === 0) {
          setOrgs(entries);
          setActiveOrgState(null);
          return;
        }

        const preferred = target ?? readPersistedOrgId();
        let restored = preferred ? findOrgByRef(entries, preferred) : undefined;
        if (!restored && preferred) {
          const opened = await readOpenedOrg(preferred);
          if (fetchId !== fetchIdRef.current) return;
          // A slug the organization was renamed away from resolves to one
          // of the person's own: the list's entry is selected, never a
          // second object for it.
          restored = opened
            ? (findOrgByRef(entries, opened.metadata?.id ?? "") ?? opened)
            : undefined;
        }

        const selected = restored ?? entries[0];
        setOrgs(entries);
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
    [stigmer, readOpenedOrg],
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
 * @internal Not part of the public `@stigmer/react-sdk` API.
 */
export function useOptionalOrg(): OrgContextValue | null {
  return useContext(OrgContext);
}

/**
 * The organizations an id or slug can be resolved against: the person's
 * own and the one they have open (see {@link OrgContextValue.activeOrg}),
 * or `undefined` when no {@link OrgProvider} is mounted. Stable while
 * neither changes. Read `orgs` instead where the person's own list is
 * meant (the switcher, the gate).
 *
 * @internal Not part of the public `@stigmer/react-sdk` API.
 */
export function useKnownOrgs(): readonly Organization[] | undefined {
  const ctx = useOptionalOrg();
  const orgs = ctx?.orgs;
  const activeOrg = ctx?.activeOrg ?? null;
  return useMemo(
    () => (orgs ? knownOrgs(orgs, activeOrg) : undefined),
    [orgs, activeOrg],
  );
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
