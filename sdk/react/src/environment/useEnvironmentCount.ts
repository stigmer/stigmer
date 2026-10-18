"use client";

import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";
import { listEnvironmentsPage } from "./environmentListFn.js";

/** Options for {@link useEnvironmentCount}. */
export interface UseEnvironmentCountOptions {
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useEnvironmentCount}. */
export interface UseEnvironmentCountReturn {
  /** The Environments a first page holds, up to 100. `undefined` until the first successful fetch completes. */
  readonly count: number | undefined;
  /** `true` when more Environments follow that page: a card reads "100+". */
  readonly isLowerBound: boolean;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
  readonly refetch: () => void;
}

interface EnvironmentCount {
  readonly count: number;
  readonly isLowerBound: boolean;
}

/**
 * Data hook that counts the Environments the caller can view in an
 * organization, for the Library landing card.
 *
 * Environments are not in search, so no per-kind count exists for them:
 * the hook reads the list's largest page and counts it, with
 * `isLowerBound` set when more follow (the routine count's shape).
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLowerBound, isLoading } = useEnvironmentCount("acme");
 * ```
 */
export function useEnvironmentCount(
  org: string | null,
  options?: UseEnvironmentCountOptions,
): UseEnvironmentCountReturn {
  const stigmer = useStigmer();
  const refetchToken = options?.refetchToken;

  const { data, isLoading, error, refetch } = useFetch<EnvironmentCount | undefined>(
    org
      ? async () => {
          const page = await listEnvironmentsPage(stigmer, org, { pageSize: LIST_PAGE_MAX });
          return { count: page.entries.length, isLowerBound: page.nextPageToken !== "" };
        }
      : null,
    [stigmer, org, refetchToken],
    undefined,
  );

  return {
    count: data?.count,
    isLowerBound: data?.isLowerBound ?? false,
    isLoading,
    error,
    refetch,
  };
}
