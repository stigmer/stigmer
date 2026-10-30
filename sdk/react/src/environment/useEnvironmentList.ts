"use client";

/**
 * The Environments the caller can view in an organization. An organization
 * holds a handful, and the picker chooses among all of them, so the hook
 * walks every page of the list and answers the whole set, as the vault
 * list does.
 */
import { create } from "@bufbuild/protobuf";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { ListEnvironmentsRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { LIST_PAGE_MAX, readEveryPage } from "@stigmer/react-core/internal";
import { useFetch } from "@stigmer/react-core/internal";

/** Return value of {@link useEnvironmentList}. */
export interface UseEnvironmentListReturn {
  /** The Environments the caller can view, newest first. Empty while loading or on error. */
  readonly environments: readonly Environment[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list. */
  readonly refetch: () => void;
}

/**
 * Data hook listing the Environments the caller can view in `org`. Pass
 * `null` to skip (stable no-op).
 *
 * @example
 * ```tsx
 * const { environments } = useEnvironmentList("acme");
 * ```
 */
export function useEnvironmentList(org: string | null): UseEnvironmentListReturn {
  const stigmer = useStigmer();

  const fetchFn = org
    ? () =>
        readEveryPage((pageToken) =>
          stigmer.environment.list(
            create(ListEnvironmentsRequestSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
          ),
        )
    : null;

  const { data: environments, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stigmer],
    [] as Environment[],
  );

  return { environments, isLoading, isRefetching, error, refetch };
}

/** The name a person knows an Environment by: its display name, else its slug. */
export function environmentName(environment: Environment): string {
  return environment.metadata?.name || environment.metadata?.slug || "";
}
