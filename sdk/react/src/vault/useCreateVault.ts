"use client";

/**
 * Creating a shared vault: the organization's, made by an admin, empty and
 * private until it is shared. A person's own My vault is never created
 * here; the server creates it on their first save (useMyVault).
 */
import { useCallback, useState } from "react";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** What a new shared vault starts with. */
export interface CreateVaultInput {
  /** Organization the vault belongs to. */
  readonly org: string;
  /** Display name, such as "Support tools". */
  readonly name: string;
  /** What the vault is for. */
  readonly description?: string;
  /** The integrator's own id for it, unique in the organization. */
  readonly externalId?: string;
}

/** Return value of {@link useCreateVault}. */
export interface UseCreateVaultReturn {
  /** Create a shared vault. Resolves with the created vault. */
  readonly create: (input: CreateVaultInput) => Promise<Vault>;
  /** `true` while the request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that creates a shared vault. Only an organization's admins
 * may; the server refuses everyone else.
 *
 * @example
 * ```tsx
 * const { create } = useCreateVault();
 * await create({ org: "acme", name: "Support tools" });
 * ```
 */
export function useCreateVault(): UseCreateVaultReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: CreateVaultInput): Promise<Vault> => {
      setIsCreating(true);
      setError(null);
      try {
        return await stigmer.vault.create({
          name: input.name,
          org: input.org,
          ...(input.description ? { description: input.description } : {}),
          ...(input.externalId ? { externalId: input.externalId } : {}),
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
