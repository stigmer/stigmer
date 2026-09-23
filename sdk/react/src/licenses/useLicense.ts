"use client";

import { useMemo } from "react";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useLicense}. */
export interface UseLicenseReturn {
  /** The license with its signed ticket, or `null` before the fetch lands. */
  readonly license: License | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard the fetched license and read it again. */
  readonly refetch: () => void;
}

/**
 * Data hook that reads one issued license, including `status.ticket`: the
 * signed ticket the customer installs. This is the only read that carries
 * the ticket, and it is deliberately not cached across mounts, so a ticket
 * never outlives the view that asked for it.
 *
 * Platform-operator surface: the caller needs `can_issue_license` on
 * `platform:stigmer`.
 *
 * Pass `enabled: false` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { license } = useLicense(licenseId);
 * const ticket = license?.status?.ticket;
 * ```
 */
export function useLicense(
  id: string,
  options?: { readonly enabled?: boolean },
): UseLicenseReturn {
  const stigmer = useStigmer();
  const enabled = (options?.enabled ?? true) && id !== "";

  const { data: license, isLoading, error, refetch } = useFetch(
    enabled ? () => stigmer.license.get(id) : null,
    [enabled, id, stigmer],
    null as License | null,
  );

  return useMemo(
    () => ({ license, isLoading, error, refetch }),
    [license, isLoading, error, refetch],
  );
}
