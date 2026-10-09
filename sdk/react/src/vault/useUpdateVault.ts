"use client";

/**
 * Renaming a vault and changing its description or external id. Entries
 * are never part of an update: the server keeps them as stored, and they
 * change only through the entry writes (useVaultEntries, useMyVault).
 */
import { useCallback, useState } from "react";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** The fields an update may change, on the vault it names. */
export interface UpdateVaultInput {
  /** The vault as loaded (its id, org and slug address the update). */
  readonly vault: Vault;
  readonly name?: string;
  readonly description?: string;
  readonly externalId?: string;
}

/** Return value of {@link useUpdateVault}. */
export interface UseUpdateVaultReturn {
  /** Update a vault's name, description or external id. */
  readonly update: (input: UpdateVaultInput) => Promise<Vault>;
  /** `true` while the request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/** Behavior hook that updates a vault's own fields. */
export function useUpdateVault(): UseUpdateVaultReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: UpdateVaultInput): Promise<Vault> => {
      setIsUpdating(true);
      setError(null);
      const metadata = input.vault.metadata;
      try {
        return await stigmer.vault.update({
          id: metadata?.id,
          name: input.name ?? metadata?.name ?? "",
          slug: metadata?.slug,
          org: metadata?.org ?? "",
          description: input.description ?? input.vault.spec?.description ?? "",
          externalId: input.externalId ?? input.vault.spec?.externalId ?? "",
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
