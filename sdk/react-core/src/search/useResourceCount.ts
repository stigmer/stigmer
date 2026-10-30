"use client";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { LibraryKind } from "./librarySource.js";

export interface UseResourceCountOptions {
  /** Text query to filter results before counting. */
  readonly query?: string;
  /**
   * Opaque token that forces a recount whenever its value changes. Use
   * it to refresh the count after an out-of-band mutation (e.g. applying
   * a manifest) without remounting. Mirrors the `refetchToken` on
   * {@link useResourceCollection}.
   */
  readonly refetchToken?: unknown;
}

export interface UseResourceCountReturn {
  /**
   * Total count of matching resources. `undefined` until the first
   * successful fetch completes — distinguishes "not yet loaded" from
   * "loaded, count is zero."
   */
  readonly count: number | undefined;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Internal hook that fetches the total count of a Library kind.
 *
 * Powers the public resource count hooks (`useAgentCount`, `useSkillCount`,
 * `usePluginCount`) — not exported from the public API.
 *
 * A list carries no total; search counts its matches per kind
 * (`countsByKind`) across every page, so the count is a one-row search
 * scoped to the kind, read for that kind alone. With no query it counts
 * every row of the kind the caller may read in the organization: the rows
 * the Library's list pages through.
 */
export function useResourceCount(
  kind: LibraryKind,
  org: string | null,
  options?: UseResourceCountOptions,
): UseResourceCountReturn {
  const stigmer = useStigmer();
  const query = options?.query;
  const refetchToken = options?.refetchToken;

  const { data: count, isLoading, isRefetching, error, refetch } = useFetch<number | undefined>(
    org
      ? async () => {
          // `org` is ALWAYS sent: an empty org means "every org the caller
          // can access" to the search backend (a global authorization dump).
          const page = await stigmer.search.query({
            kinds: [kind],
            org,
            query: query || undefined,
            pageSize: 1,
          });
          return page.countsByKind[ApiResourceKind[kind]] ?? 0;
        }
      : null,
    [stigmer, kind, org, query, refetchToken],
    undefined,
  );

  return { count, isLoading, isRefetching, error, refetch };
}
