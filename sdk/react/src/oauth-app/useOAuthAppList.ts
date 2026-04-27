"use client";

import { create } from "@bufbuild/protobuf";
import { ListOAuthAppsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/io_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useOAuthAppList}. */
export interface UseOAuthAppListReturn {
  /** OAuth apps owned by the organization. Empty while loading or on error. */
  readonly oauthApps: readonly OAuthApp[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
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

  const { data: oauthApps, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          stigmer.oauthapp
            .listByOrg(create(ListOAuthAppsByOrgInputSchema, { org }))
            .then((r) => [...r.entries])
      : null,
    [org, stigmer],
    [] as OAuthApp[],
  );

  return { oauthApps, isLoading, isRefetching, error, refetch };
}
