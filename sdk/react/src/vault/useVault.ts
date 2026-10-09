"use client";

/**
 * One vault by its organization and slug, values blanked as every read is.
 */
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useVault}. */
export interface UseVaultReturn {
  /** The vault, or `null` while loading or on error. */
  readonly vault: Vault | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the vault. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single vault by reference. Pass `null` to skip.
 *
 * @example
 * ```tsx
 * const { vault } = useVault({ org: "acme", slug: "support-tools" });
 * ```
 */
export function useVault(ref: ResourceRef | null): UseVaultReturn {
  const stigmer = useStigmer();
  const org = ref?.org;
  const slug = ref?.slug;

  const fetchFn =
    org && slug ? () => stigmer.vault.getByReference({ org, slug }) : null;

  const { data: vault, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, slug, stigmer],
    null,
  );

  return { vault, isLoading, isRefetching, error, refetch };
}
