"use client";

import type { ProviderStandingView } from "@stigmer/protos/ai/stigmer/platform/providerstanding/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useProviderStanding}. */
export interface UseProviderStandingReturn {
  /** The standing view, or `null` before the first successful fetch. */
  readonly standing: ProviderStandingView | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook for platform provider standing: the latest canary-probe
 * verdict per platform LLM provider account (status, latency, bounded
 * error summary, probe time), recorded hourly by the standing probe.
 *
 * Platform-operator surface: the caller needs
 * `can_view_provider_standing` on `platform:stigmer`. Cloud-only — the
 * OSS server does not implement the controller.
 *
 * Pass `enabled: false` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { standing, isLoading, refetch } = useProviderStanding();
 * ```
 */
export function useProviderStanding(
  options?: { readonly enabled?: boolean },
): UseProviderStandingReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;

  const { data: standing, isLoading, isRefetching, error, refetch } = useFetch(
    enabled ? () => stigmer.providerStanding.getStandingView() : null,
    [enabled, stigmer],
    null as ProviderStandingView | null,
  );

  return { standing, isLoading, isRefetching, error, refetch };
}
