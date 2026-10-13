"use client";

/**
 * Renaming a vault and changing its description or external id. The
 * update names only the fields the input sets, on the vault as loaded
 * (its id and the etag it was read at), so a change made since to another
 * field stays, and a vault changed since it was read refuses the save
 * (ABORTED, reason `ETAG_MISMATCH`). Entries are never part of an update:
 * they change only through the entry writes (useVaultEntries, useMyVault).
 */
import { useCallback, useState } from "react";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** The fields an update may change, on the vault it names. */
export interface UpdateVaultInput {
  /** The vault as loaded (its id addresses the update, its etag guards it). */
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
      const paths = [
        ...(input.name !== undefined ? ["metadata.name"] : []),
        ...(input.description !== undefined ? ["spec.description"] : []),
        ...(input.externalId !== undefined ? ["spec.external_id"] : []),
      ];
      if (paths.length === 0) {
        // Nothing to change: an update must name a field.
        setIsUpdating(false);
        return input.vault;
      }
      try {
        return await stigmer.vault.update(
          {
            metadata: { id: metadata?.id ?? "", etag: metadata?.etag ?? "", name: input.name ?? "" },
            spec: { description: input.description ?? "", externalId: input.externalId ?? "" },
          },
          paths,
        );
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
