"use client";

/**
 * The composer's Sign in row for a run that never reads My vault (the
 * agent, or a subagent it lists, is another organization's): the login is
 * saved in the shared vault the panel chose, one the conversation lists
 * and the person may edit (`SignInVaults`, decided by `useAgentSetup`), so
 * the run reads it. A sign-in into My vault would land where this run never
 * looks.
 *
 * It renders the same cell as an owed sign-in into My vault
 * (`SignInNeededCell`), and never shows a My vault login's "Signed in":
 * that login is not one this run reads. Once the login lands, `onSignedIn`
 * receives the address it was saved at; the composer records the sign-in
 * against the agent, which resolves again over the listed vaults, read
 * fresh. A start the server refuses (the person may no longer edit the
 * vault) shows the server's words in the cell.
 *
 * Internal to the composer, not exported from the kit.
 */

import { useCallback } from "react";
import type { PendingSignIn, SignInVault } from "../agent/agentSetupReducer.js";
import { SignInNeededCell } from "../plugin/PluginServerSignIn.js";
import { useVaultSignIn } from "../vault/useVaultSignIn.js";

/** Props for {@link SharedVaultSignIn}. */
export interface SharedVaultSignInProps {
  /** The sign-in the run still owes. */
  readonly signIn: PendingSignIn;
  /** The shared vault the login is saved in. */
  readonly vault: SignInVault;
  /** Called with the address once the login is saved. */
  readonly onSignedIn: (address: string) => void;
}

/** One owed sign-in, saved into a shared vault. */
export function SharedVaultSignIn({ signIn, vault, onSignedIn }: SharedVaultSignInProps) {
  const { signIn: start, phase, isInProgress, error } = useVaultSignIn();
  const { address } = signIn;
  const { org, id } = vault;
  const onSignIn = useCallback(() => {
    start(address, { org, vaultId: id }).then(
      () => onSignedIn(address),
      () => {
        // useVaultSignIn holds the failure; the cell shows it.
      },
    );
  }, [start, address, org, id, onSignedIn]);
  return (
    <SignInNeededCell name={signIn.server.name} isSigningIn={isInProgress} phase={phase} error={error} onSignIn={onSignIn} />
  );
}
