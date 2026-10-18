"use client";

import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { isNotFound } from "@stigmer/client";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useEnvironment}. */
export interface UseEnvironmentReturn {
  /** The resolved Environment, or `null` while loading, on error, or when not found. */
  readonly environment: Environment | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the Environment from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches one Environment by organization and slug, through
 * `stigmer.environment.getByReference()`: its description, network policy
 * and packages.
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable no-op).
 *
 * **Not-found handling:** a NOT_FOUND response sets `environment` to
 * `null` without raising an error; `environment === null && !isLoading &&
 * !error` means the Environment does not exist, or the caller may not
 * view it.
 *
 * @example
 * ```tsx
 * const { environment, isLoading, error, refetch } = useEnvironment("acme", "data-science");
 * ```
 */
export function useEnvironment(org: string | null, slug: string | null): UseEnvironmentReturn {
  const stigmer = useStigmer();

  const { data: environment, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.environment.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    null,
  );

  return { environment, isLoading, isRefetching, error, refetch };
}
