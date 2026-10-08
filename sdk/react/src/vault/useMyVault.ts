"use client";

/**
 * The caller's own My vault in an organization: what it holds (entry names
 * and addresses, never values) and the writes that change it.
 *
 * My vault is created by the server on the person's first write: every
 * mutation here names `mine` as its target, so the console never creates it
 * explicitly and never races a duplicate. Reads answer `null` until the
 * first write (the server's NOT_FOUND is that state, not an error). Saved
 * values can be replaced or removed but are never read back.
 */
import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { isNotFound } from "@stigmer/sdk";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  GetMyVaultInputSchema,
  RemoveVaultConnectionsInputSchema,
  RemoveVaultSecretsInputSchema,
  SetVaultConnectionInputSchema,
  SetVaultSecretsInputSchema,
  VaultSecretInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { toError } from "../internal/toError.js";
import { myVaultTarget } from "./target.js";

/** A secret to save: its value, and optionally what it is for. */
export interface VaultSecretValue {
  readonly value: string;
  readonly description?: string;
}

/** Return value of {@link useMyVault}. */
export interface UseMyVaultReturn {
  /** The caller's My vault (values blanked), or `null` before the first save or while loading. */
  readonly vault: Vault | null;
  /** Names of the secrets My vault holds. */
  readonly secretNames: ReadonlySet<string>;
  /** Normalized addresses of the logins My vault holds. */
  readonly connectionAddresses: ReadonlySet<string>;
  /** `true` while the first read is in flight. */
  readonly isLoading: boolean;
  /** The last failed read or write, or `null`. */
  readonly error: Error | null;
  /** Re-read My vault. */
  readonly refetch: () => void;
  /** Save secrets by name, replacing any saved under the same names. */
  readonly setSecrets: (
    secrets: Readonly<Record<string, string | VaultSecretValue>>,
  ) => Promise<Vault>;
  /** Remove secrets by name; names not saved are ignored. */
  readonly removeSecrets: (names: readonly string[]) => Promise<Vault>;
  /** Save a login at the address of the tool or Git host it is for. */
  readonly setConnection: (
    address: string,
    token: string,
    description?: string,
  ) => Promise<Vault>;
  /** Remove logins by address; addresses not saved are ignored. */
  readonly removeConnections: (addresses: readonly string[]) => Promise<Vault>;
  /** `true` while any write is in flight. */
  readonly isMutating: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Data and behavior hook for the caller's My vault in `org`. Pass `null` to
 * skip (a stable no-op: writes throw).
 *
 * @example
 * ```tsx
 * const myVault = useMyVault("acme");
 * await myVault.setSecrets({ OPENAI_API_KEY: "sk-..." });
 * myVault.secretNames.has("OPENAI_API_KEY"); // true after the refetch
 * ```
 */
export function useMyVault(org: string | null): UseMyVaultReturn {
  const stigmer = useStigmer();
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);

  const fetchFn = org
    ? async (): Promise<Vault | null> => {
        try {
          return await stigmer.vault.getMine(create(GetMyVaultInputSchema, { org }));
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  const { data: vault, isLoading, error: readError, refetch } = useFetch(
    fetchFn,
    [org, stigmer],
    null,
  );

  const secretNames = useMemo<ReadonlySet<string>>(
    () => (vault ? new Set(Object.keys(vault.spec?.secrets ?? {})) : EMPTY),
    [vault],
  );
  const connectionAddresses = useMemo<ReadonlySet<string>>(
    () => (vault ? new Set(Object.keys(vault.spec?.connections ?? {})) : EMPTY),
    [vault],
  );

  const mutate = useCallback(
    async (write: (org: string) => Promise<Vault>): Promise<Vault> => {
      if (!org) {
        throw new Error("useMyVault: cannot write when org is null.");
      }
      setIsMutating(true);
      setMutationError(null);
      try {
        const updated = await write(org);
        refetch();
        return updated;
      } catch (err) {
        setMutationError(toError(err));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [org, refetch],
  );

  const setSecrets = useCallback(
    (secrets: Readonly<Record<string, string | VaultSecretValue>>) =>
      mutate((o) =>
        stigmer.vault.setSecrets(
          create(SetVaultSecretsInputSchema, {
            vault: myVaultTarget(o),
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
    [mutate, stigmer],
  );

  const removeSecrets = useCallback(
    (names: readonly string[]) =>
      mutate((o) =>
        stigmer.vault.removeSecrets(
          create(RemoveVaultSecretsInputSchema, {
            vault: myVaultTarget(o),
            names: [...names],
          }),
        ),
      ),
    [mutate, stigmer],
  );

  const setConnection = useCallback(
    (address: string, token: string, description?: string) =>
      mutate((o) =>
        stigmer.vault.setConnection(
          create(SetVaultConnectionInputSchema, {
            vault: myVaultTarget(o),
            address,
            token,
            description: description ?? "",
          }),
        ),
      ),
    [mutate, stigmer],
  );

  const removeConnections = useCallback(
    (addresses: readonly string[]) =>
      mutate((o) =>
        stigmer.vault.removeConnections(
          create(RemoveVaultConnectionsInputSchema, {
            vault: myVaultTarget(o),
            addresses: [...addresses],
          }),
        ),
      ),
    [mutate, stigmer],
  );

  return {
    vault,
    secretNames,
    connectionAddresses,
    isLoading,
    error: mutationError ?? readError,
    refetch,
    setSecrets,
    removeSecrets,
    setConnection,
    removeConnections,
    isMutating,
  };
}
