"use client";

/**
 * The entry writes on a vault named by id: save and remove secrets by name,
 * save and remove logins by address. A person's own My vault is written
 * through useMyVault instead, which names it without knowing its id.
 *
 * Saved values are never read back; a write returns the vault with every
 * value blanked.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  RemoveVaultConnectionsInputSchema,
  RemoveVaultSecretsInputSchema,
  SetVaultConnectionInputSchema,
  SetVaultSecretsInputSchema,
  VaultSecretInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { vaultTargetById } from "./target.js";
import type { VaultSecretValue } from "./useMyVault.js";

/** Return value of {@link useVaultEntries}. */
export interface UseVaultEntriesReturn {
  readonly setSecrets: (
    secrets: Readonly<Record<string, string | VaultSecretValue>>,
  ) => Promise<Vault>;
  readonly removeSecrets: (names: readonly string[]) => Promise<Vault>;
  readonly setConnection: (
    address: string,
    token: string,
    description?: string,
  ) => Promise<Vault>;
  readonly removeConnections: (addresses: readonly string[]) => Promise<Vault>;
  /** `true` while any write is in flight. */
  readonly isMutating: boolean;
  /** Error from the last failed write, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook for the entries of the vault `vaultId` in `org` (pass
 * `null` for either to make every write throw).
 *
 * @example
 * ```tsx
 * const entries = useVaultEntries("acme", vault.metadata!.id);
 * await entries.setSecrets({ ZENDESK_API_KEY: "..." });
 * ```
 */
export function useVaultEntries(
  org: string | null,
  vaultId: string | null,
): UseVaultEntriesReturn {
  const stigmer = useStigmer();
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (write: (o: string, id: string) => Promise<Vault>): Promise<Vault> => {
      if (!org || !vaultId) {
        throw new Error("useVaultEntries: org and vaultId are required to write.");
      }
      setIsMutating(true);
      setError(null);
      try {
        return await write(org, vaultId);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [org, vaultId],
  );

  const setSecrets = useCallback(
    (secrets: Readonly<Record<string, string | VaultSecretValue>>) =>
      run((o, id) =>
        stigmer.vault.setSecrets(
          create(SetVaultSecretsInputSchema, {
            vault: vaultTargetById(o, id),
            secrets: Object.fromEntries(
              Object.entries(secrets).map(([name, s]) => [
                name,
                create(
                  VaultSecretInputSchema,
                  typeof s === "string"
                    ? { value: s }
                    : { value: s.value, description: s.description ?? "" },
                ),
              ]),
            ),
          }),
        ),
      ),
    [run, stigmer],
  );

  const removeSecrets = useCallback(
    (names: readonly string[]) =>
      run((o, id) =>
        stigmer.vault.removeSecrets(
          create(RemoveVaultSecretsInputSchema, {
            vault: vaultTargetById(o, id),
            names: [...names],
          }),
        ),
      ),
    [run, stigmer],
  );

  const setConnection = useCallback(
    (address: string, token: string, description?: string) =>
      run((o, id) =>
        stigmer.vault.setConnection(
          create(SetVaultConnectionInputSchema, {
            vault: vaultTargetById(o, id),
            address,
            token,
            description: description ?? "",
          }),
        ),
      ),
    [run, stigmer],
  );

  const removeConnections = useCallback(
    (addresses: readonly string[]) =>
      run((o, id) =>
        stigmer.vault.removeConnections(
          create(RemoveVaultConnectionsInputSchema, {
            vault: vaultTargetById(o, id),
            addresses: [...addresses],
          }),
        ),
      ),
    [run, stigmer],
  );

  return {
    setSecrets,
    removeSecrets,
    setConnection,
    removeConnections,
    isMutating,
    error,
  };
}
