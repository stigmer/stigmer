"use client";

/**
 * The vaults the caller can see in an organization: their own My vault and
 * the shared vaults they may view. Entry values are never part of a read.
 */
import { create } from "@bufbuild/protobuf";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ListVaultsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useVaultList}. */
export interface UseVaultListReturn {
  /** The vaults the caller can see, newest first. Empty while loading or on error. */
  readonly vaults: readonly Vault[];
  /** Total number of vaults the server counted. */
  readonly totalCount: number;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list. */
  readonly refetch: () => void;
}

/** Whether a vault is a person's own My vault rather than an organization's shared vault. */
export function isMyVault(vault: Vault): boolean {
  return vault.spec?.owner.case === "person";
}

/**
 * Data hook listing the vaults the caller can see in `org`. Pass `null` to
 * skip (stable no-op).
 *
 * @example
 * ```tsx
 * const { vaults } = useVaultList("acme");
 * const shared = vaults.filter((v) => !isMyVault(v));
 * ```
 */
export function useVaultList(org: string | null): UseVaultListReturn {
  const stigmer = useStigmer();

  const fetchFn = org
    ? async () => {
        const result = await stigmer.vault.list(
          create(ListVaultsRequestSchema, { org }),
        );
        return { vaults: result.items as Vault[], totalCount: result.totalCount };
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stigmer],
    { vaults: [] as Vault[], totalCount: 0 },
  );

  return {
    vaults: data.vaults,
    totalCount: data.totalCount,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
