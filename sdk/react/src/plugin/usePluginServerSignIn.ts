"use client";

/**
 * What stands between one of a plugin's MCP servers and its first tool
 * call, for the person looking, as one state a row renders: signed in,
 * sign-in needed (with the act that does it), a key to give, or nothing.
 *
 * A server signs in when the plugin's status says so (`sign_in` on an HTTP
 * entry). A login is saved at the server's address, never under the server:
 * the login in My vault at that address (or, for a server on GitHub's own
 * API, the github.com login) fills every HTTP tool there, whichever page
 * signed in, which is the run's own rule (`vaultLoginServes`). So the state
 * is read from My vault (`useMyVault`), the sign-in is `useVaultSignIn` at
 * the address, and signing out removes the login at the address with
 * `removeConnections`. A server without `sign_in` that reads variables
 * wants a key; one with neither is open.
 *
 * Only My vault is read: a sign-in made here is saved there, and a shared
 * vault's logins are the business of the conversations that list it.
 */

import { useCallback, useMemo, useState } from "react";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { VaultConnection } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { toError } from "../internal/toError.js";
import { toolAddressOf, vaultLoginServes } from "../vault/address.js";
import { useMyVault } from "../vault/useMyVault.js";
import { type VaultSignInPhase, useVaultSignIn } from "../vault/useVaultSignIn.js";

/** One of the things a server can want before its first tool call. */
export type PluginServerSignInKind =
  /** My vault is being read. */
  | "loading"
  /** My vault could not be read; `error` says why. */
  | "unreadable"
  /** The server signs in, and My vault holds a login that serves its address. */
  | "signed-in"
  /** The server signs in, and no login serves its address yet; `signIn` starts one. */
  | "sign-in-needed"
  /** The server reads keys by name, given when a conversation that uses it starts. */
  | "api-key"
  /** Neither a sign-in nor keys: nothing stands between the server and a tool call. */
  | "open";

/** Return value of {@link usePluginServerSignIn}. */
export interface UsePluginServerSignInReturn {
  readonly kind: PluginServerSignInKind;
  /** The address a login for this server is saved at; `null` for a local program. */
  readonly address: string | null;
  /** The login saved at exactly this address, when there is one: what "Sign out" removes. */
  readonly connection: VaultConnection | null;
  /** The variables an `api-key` server reads, in the plugin's order. */
  readonly declaredVariables: readonly string[];
  /** The read error, or the last sign-in or sign-out error, or `null`. */
  readonly error: Error | null;
  /** Start the sign-in. Call from a click handler so the popup is allowed. A no-op unless `kind` is `sign-in-needed`. */
  readonly signIn: () => void;
  /** Remove the login saved at this address from My vault. */
  readonly signOut: () => Promise<void>;
  /** The sign-in's phase; `idle` when none is running. */
  readonly phase: VaultSignInPhase;
  readonly isSigningIn: boolean;
  readonly isSigningOut: boolean;
  /** Read My vault again. */
  readonly refetch: () => void;
}

/**
 * Behaviour hook for one plugin server's sign-in. Pass `null` for either
 * argument to hold the hook idle.
 *
 * @param onSignedIn - Called with the address when a sign-in started here lands.
 *
 * @example
 * ```tsx
 * const signIn = usePluginServerSignIn(org, plugin.status.mcpServers[0]);
 * if (signIn.kind === "sign-in-needed") return <button onClick={signIn.signIn}>Sign in</button>;
 * ```
 */
export function usePluginServerSignIn(
  org: string | null,
  server: McpServerEntry | null,
  onSignedIn?: (address: string) => void,
): UsePluginServerSignInReturn {
  const myVault = useMyVault(org);
  const vaultSignIn = useVaultSignIn();
  const [signOutError, setSignOutError] = useState<Error | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const address = useMemo(() => toolAddressOf(server), [server]);
  const signsIn = server !== null && server.transport.case === "http" && server.signIn !== undefined;
  const connections = myVault.vault?.spec?.connections;
  const connection = address !== null ? (connections?.[address] ?? null) : null;
  const declaredVariables = server?.env ?? EMPTY;

  const kind = useMemo<PluginServerSignInKind>(() => {
    if (server === null || org === null) return "loading";
    if (!signsIn) return declaredVariables.length > 0 ? "api-key" : "open";
    if (myVault.isLoading) return "loading";
    if (myVault.vault === null && myVault.error !== null) return "unreadable";
    return vaultLoginServes(connections ?? {}, server) ? "signed-in" : "sign-in-needed";
  }, [server, org, signsIn, declaredVariables.length, myVault.isLoading, myVault.vault, myVault.error, connections]);

  const { refetch } = myVault;
  const startSignIn = vaultSignIn.signIn;
  const clearSignInError = vaultSignIn.clearError;
  const signIn = useCallback(() => {
    if (kind !== "sign-in-needed" || address === null || org === null) return;
    clearSignInError();
    setSignOutError(null);
    // A sign-in that fails leaves the row on "Sign in" with the reason; one
    // that lands rereads My vault, so the row says "Signed in" from the login.
    void startSignIn(address, { org }).then(
      () => {
        refetch();
        onSignedIn?.(address);
      },
      () => undefined,
    );
  }, [kind, address, org, startSignIn, clearSignInError, refetch, onSignedIn]);

  const { removeConnections } = myVault;
  const signOut = useCallback(async () => {
    if (address === null || connection === null) return;
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await removeConnections([address]);
    } catch (err) {
      setSignOutError(toError(err));
      throw err;
    } finally {
      setIsSigningOut(false);
    }
  }, [address, connection, removeConnections]);

  const error = vaultSignIn.error ?? signOutError ?? (kind === "unreadable" ? myVault.error : null);

  return useMemo(
    () => ({
      kind,
      address,
      connection,
      declaredVariables,
      error,
      signIn,
      signOut,
      phase: vaultSignIn.phase,
      isSigningIn: vaultSignIn.isInProgress,
      isSigningOut,
      refetch,
    }),
    [kind, address, connection, declaredVariables, error, signIn, signOut, vaultSignIn.phase, vaultSignIn.isInProgress, isSigningOut, refetch],
  );
}

const EMPTY: readonly string[] = [];
