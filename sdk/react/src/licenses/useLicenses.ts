"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { ListLicensesInputSchema } from "@stigmer/protos/ai/stigmer/billing/license/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useLicenses}. */
export interface UseLicensesReturn {
  /**
   * Every issued license, or `null` before the first successful fetch.
   * List entries never carry the signed ticket; {@link useLicense} reads it.
   */
  readonly licenses: readonly License[] | null;
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
 * Data hook that lists every issued Stigmer license: its customer, term,
 * entitlements and dates. The list is the renewal calendar's source; the
 * server leaves the signed ticket off every entry.
 *
 * Platform-operator surface: the caller needs `can_issue_license` on
 * `platform:stigmer`. Cloud-only: other editions do not issue licenses.
 *
 * Pass `enabled: false` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { licenses, isLoading, refetch } = useLicenses();
 * ```
 */
export function useLicenses(
  options?: { readonly enabled?: boolean },
): UseLicensesReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;

  const { data: licenses, isLoading, isRefetching, error, refetch } = useFetch(
    enabled
      ? () =>
          stigmer.license
            .list(create(ListLicensesInputSchema))
            .then((result): readonly License[] => result.entries)
      : null,
    [enabled, stigmer],
    null as readonly License[] | null,
  );

  return useMemo(
    () => ({ licenses, isLoading, isRefetching, error, refetch }),
    [licenses, isLoading, isRefetching, error, refetch],
  );
}
