"use client";

/**
 * useCredentialList: the credentials the caller may see in an
 * organization, split the way a person reads them. The server answers
 * with the caller's own credentials and the organization's they may use
 * (every one of the organization's for an admin), never another person's,
 * with secret values redacted.
 */
import { useMemo } from "react";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { isOrgCredential, isOwnCredential } from "./model.js";
import { listCredentials } from "./serving.js";

/** Return value of {@link useCredentialList}. */
export interface UseCredentialListReturn {
  /** Every credential the caller may see, newest first. Empty while loading or on error. */
  readonly credentials: readonly Credential[];
  /** The caller's own credentials. */
  readonly mine: readonly Credential[];
  /** The organization's credentials the caller may use (all of them, for an admin). */
  readonly organization: readonly Credential[];
  /** `true` while the first fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the list, after a change made elsewhere. */
  readonly refetch: () => void;
}

const NONE: readonly Credential[] = [];

/**
 * Data hook that lists the credentials the caller may see in `org`.
 *
 * Pass `null` as `org` to skip fetching (stable no-op). Results are cached
 * across mounts under a fetch cache, so every surface that reads the list
 * (the composer, the settings page, a picker) renders instantly on a
 * revisit and refetches in the background.
 *
 * @example
 * ```tsx
 * const { mine, organization, isLoading } = useCredentialList("acme");
 * ```
 */
export function useCredentialList(org: string | null): UseCredentialListReturn {
  const stigmer = useStigmer();
  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    org ? () => listCredentials(stigmer, org) : null,
    [org, stigmer],
    NONE as Credential[],
    { cacheKey: org ? `credentials:${org}` : undefined },
  );

  const mine = useMemo(() => data.filter(isOwnCredential), [data]);
  const organization = useMemo(() => data.filter(isOrgCredential), [data]);

  return useMemo(
    () => ({
      credentials: data,
      mine,
      organization,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [data, mine, organization, isLoading, isRefetching, error, refetch],
  );
}
