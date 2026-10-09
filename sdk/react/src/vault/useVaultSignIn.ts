"use client";

/**
 * A sign-in at an address, saved into a vault: the one browser flow every
 * sign-in surface shares (an MCP server's "Sign in", "Connect GitHub", "Sign
 * in again" on a saved login).
 *
 * The server finds the login for the address (the organization's own login
 * app, Stigmer's built-in one, or the address's own login server) and saves
 * the login into the vault named: the caller's My vault, or a shared vault
 * they may edit. A login saved at an address fills every HTTP tool whose URL
 * is that address, so nothing here names a tool.
 *
 * {@link runPopupSignIn} is the flow over a popup the caller already opened
 * (it must be opened synchronously inside the click handler, before any
 * await, or the browser blocks it): `startSignIn`, the login page in the
 * popup, the callback page's `{ code, state }` (OAuthCallbackHandler), then
 * `completeSignIn`. {@link useVaultSignIn} wraps it with phases and errors
 * for a component that only signs in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import {
  CompleteSignInInputSchema,
  SignInReturn,
  StartSignInInputSchema,
  type CompleteSignInOutput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import {
  closeOAuthPopup,
  openOAuthPopup,
  popupBlockedError,
  waitForOAuthCallback,
  type OAuthPopupHandle,
} from "../internal/oauthPopup.js";
import { myVaultTarget, vaultTargetById } from "./target.js";

/** Where a sign-in saves its login: a shared vault by id, or the caller's My vault. */
export interface SignInDestination {
  /** The organization the vault belongs to. */
  readonly org: string;
  /** A shared vault's id; omitted for the caller's own My vault. */
  readonly vaultId?: string;
}

/**
 * Where the login page sends the person back to. `web` (the default) is the
 * console's callback page, which hands the result to the popup's opener;
 * `desktop` is the same page handing it on to the desktop app; `loopback`
 * is a page the desktop app serves on this machine.
 */
export type SignInReturnTo =
  | { readonly kind: "web" }
  | { readonly kind: "desktop" }
  | { readonly kind: "loopback"; readonly port: number };

/** The progress of a popup sign-in. */
export type VaultSignInPhase = "idle" | "starting" | "awaiting-callback" | "completing" | "done";

/** The `startSignIn` input for an address, a destination and a return choice. */
export function startSignInInput(address: string, destination: SignInDestination, returnTo?: SignInReturnTo) {
  const vault =
    destination.vaultId !== undefined && destination.vaultId !== ""
      ? vaultTargetById(destination.org, destination.vaultId)
      : myVaultTarget(destination.org);
  const back = returnTo ?? { kind: "web" };
  return create(StartSignInInputSchema, {
    vault,
    address,
    returnTo:
      back.kind === "desktop" ? SignInReturn.desktop : back.kind === "loopback" ? SignInReturn.loopback : SignInReturn.web,
    loopbackPort: back.kind === "loopback" ? back.port : 0,
  });
}

/** The `completeSignIn` input for what the login page handed back. */
export function completeSignInInput(state: string, code: string) {
  return create(CompleteSignInInputSchema, { state, code });
}

/**
 * Runs a sign-in in a popup the caller opened: starts it, sends the popup
 * to the login page, waits for the callback page, and completes it.
 *
 * @param onPhase - Told each phase as it begins.
 * @param onDispose - Receives a function that cancels the wait.
 */
export async function runPopupSignIn(
  stigmer: Pick<Stigmer, "vault">,
  popup: Window & OAuthPopupHandle,
  address: string,
  destination: SignInDestination,
  onPhase: (phase: VaultSignInPhase) => void,
  onDispose: (dispose: () => void) => void,
): Promise<CompleteSignInOutput> {
  onPhase("starting");
  const started = await stigmer.vault.startSignIn(startSignInInput(address, destination));
  popup.location.href = started.authorizationUrl;
  onPhase("awaiting-callback");
  const { code, state } = await waitForOAuthCallback(popup, started.state, onDispose);
  onPhase("completing");
  return stigmer.vault.completeSignIn(completeSignInInput(state, code));
}

/** Return value of {@link useVaultSignIn}. */
export interface UseVaultSignInReturn {
  /**
   * Sign in at `address` and save the login at `destination`. **Call it from
   * a synchronous click handler**: the popup opens before any await. Answers
   * the saved login's address and description.
   */
  readonly signIn: (address: string, destination: SignInDestination) => Promise<CompleteSignInOutput>;
  readonly phase: VaultSignInPhase;
  /** Whether a sign-in is in progress. */
  readonly isInProgress: boolean;
  /** The last sign-in's failure, or `null`. */
  readonly error: Error | null;
  /** Clears the error and cancels a sign-in in progress. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for a sign-in at an address, in a popup.
 *
 * @example
 * ```tsx
 * const signIn = useVaultSignIn();
 * <button onClick={() => signIn.signIn("https://mcp.linear.app/mcp", { org }).then(refetch)}>
 *   Sign in again
 * </button>
 * ```
 */
export function useVaultSignIn(): UseVaultSignInReturn {
  const stigmer = useStigmer();
  const [phase, setPhase] = useState<VaultSignInPhase>("idle");
  const [error, setError] = useState<Error | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => disposeRef.current?.(), []);

  const clearError = useCallback(() => {
    if (disposeRef.current) {
      cancelledRef.current = true;
      disposeRef.current();
      disposeRef.current = null;
    }
    setPhase("idle");
    setError(null);
  }, []);

  const signIn = useCallback(
    async (address: string, destination: SignInDestination) => {
      setError(null);
      cancelledRef.current = false;
      disposeRef.current?.();
      const popup = openOAuthPopup();
      if (!popup) {
        const blocked = popupBlockedError();
        setError(blocked);
        throw blocked;
      }
      try {
        const saved = await runPopupSignIn(stigmer, popup, address, destination, setPhase, (dispose) => {
          disposeRef.current = dispose;
        });
        setPhase("done");
        return saved;
      } catch (err) {
        const failure = toError(err);
        if (!cancelledRef.current) {
          setError(failure);
          setPhase("idle");
          closeOAuthPopup(popup);
        }
        cancelledRef.current = false;
        throw failure;
      } finally {
        disposeRef.current = null;
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({
      signIn,
      phase,
      isInProgress: phase !== "idle" && phase !== "done",
      error,
      clearError,
    }),
    [signIn, phase, error, clearError],
  );
}
