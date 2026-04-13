"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ListOAuthAppsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/io_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useOAuthAppList}. */
export interface UseOAuthAppListReturn {
  /** OAuth apps owned by the organization. Empty while loading or on error. */
  readonly oauthApps: readonly OAuthApp[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all {@link OAuthApp} entries for an organization.
 *
 * Returns every OAuthApp whose `metadata.org` matches the input. In
 * practice these are the BYOA OAuth apps created through the "Bring
 * your own app" flow on MCP server detail pages.
 *
 * Pass `null` for `org` to skip fetching (stable no-op). Useful when
 * the active organization has not been resolved yet.
 *
 * @example
 * ```tsx
 * const { oauthApps, isLoading, error } = useOAuthAppList(org);
 *
 * if (isLoading) return <Spinner />;
 * oauthApps.map((app) => app.spec?.provider);
 * ```
 */
export function useOAuthAppList(
  org: string | null,
): UseOAuthAppListReturn {
  const stigmer = useStigmer();
  const [oauthApps, setOauthApps] = useState<OAuthApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setOauthApps([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.oauthapp
      .listByOrg(create(ListOAuthAppsByOrgInputSchema, { org }))
      .then(
        (result) => {
          if (cancelled.current) return;
          setOauthApps([...result.entries]);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [org, stigmer, fetchKey]);

  return { oauthApps, isLoading, error, refetch };
}
