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
import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { useStigmerTransport } from "@stigmer/rpc-client";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface OrgContextValue {
  /** All organizations the authenticated user belongs to. */
  orgs: Organization[];
  /** The currently selected organization. Null while loading or if the user has no orgs. */
  activeOrg: Organization | null;
  /** Switch the active organization. Persisted to localStorage. */
  setActiveOrg: (org: Organization) => void;
  /** True during the initial fetch of organizations. */
  isLoading: boolean;
  /** Non-null when the fetch failed. */
  error: string | null;
  /** Re-attempt the organization fetch after a failure. */
  retry: () => void;
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
    // SSR or private-browsing — silently ignore.
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const transport = useStigmerTransport();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrgState] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIdRef = useRef(0);

  const load = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const client = createClient(OrganizationQueryController, transport);
      const request = create(EmptySchema, {});
      const response = await client.findMyOrganizations(request);
      const entries = response.entries;

      if (fetchId !== fetchIdRef.current) return;

      setOrgs(entries);

      if (entries.length === 0) {
        setActiveOrgState(null);
        return;
      }

      const persisted = readPersistedSlug();
      const restored = persisted
        ? entries.find((o) => o.metadata?.slug === persisted)
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
  }, [transport]);

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
    }),
    [orgs, activeOrg, setActiveOrg, isLoading, error, load],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the active organization context.
 *
 * Throws if called outside `<OrgProvider>` — this is intentional to surface
 * wiring mistakes immediately during development.
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
