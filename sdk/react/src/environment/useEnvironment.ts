"use client";

import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useEnvironment}. */
export interface UseEnvironmentReturn {
  /** The fetched Environment, or `null` while loading or on error. */
  readonly environment: Environment | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the environment from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Environment by resource reference.
 *
 * Pass `null` to skip fetching (stable no-op). When the reference
 * fields change, the previous in-flight request is discarded and a
 * fresh fetch begins. Call `refetch()` to re-query after mutating the
 * environment through a separate hook or API call.
 *
 * Returns the full proto {@link Environment} resource so consumers
 * have access to metadata, spec (including `data` key-value pairs),
 * and status without additional calls.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**
 * — persistent credential storage via Environment resources. For the
 * managed "personal environment" convenience, see
 * {@link usePersonalEnvironment}. For ephemeral per-execution secrets,
 * see the Execution Flow via {@link useCreateAgentExecution} with
 * `runtimeEnv`.
 *
 * @example
 * ```tsx
 * const { environment, isLoading, error } = useEnvironment({
 *   org: "acme",
 *   slug: "prod-env",
 * });
 * ```
 */
export function useEnvironment(
  ref: ResourceRef | null,
): UseEnvironmentReturn {
  const stigmer = useStigmer();

  const org = ref?.org;
  const slug = ref?.slug;
  const version = ref?.version;

  const fetchFn =
    org && slug
      ? () => stigmer.environment.getByReference({ org, slug, version })
      : null;

  const { data: environment, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, slug, version, stigmer],
    null,
  );

  return { environment, isLoading, isRefetching, error, refetch };
}
