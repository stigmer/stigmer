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
 * await, or the browser blocks it): `startSignIn`, then the login page in
 * the popup, then {@link awaitSignIn} asking the server until the sign-in
 * is finished. The login page sends the person back to the console's
 * callback page, which hands its answer to the server (`SignInReturn`), and
 * the next ask collects it under this app's own session. Nothing travels
 * between the windows, so the flow is the same whatever address this app
 * lives on, and for a login page whose `Cross-Origin-Opener-Policy` cuts the
 * popup off from this page. {@link useVaultSignIn} wraps it with phases and
 * errors for a component that only signs in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { getErrorReason, isTransientStreamError, type Stigmer } from "@stigmer/client";
import {
  CompleteSignInInputSchema,
  SignInReturn,
  StartSignInInputSchema,
  type CompleteSignInOutput,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { checkedLoginPageUrl } from "../internal/loginPageUrl.js";
import { AbortError, computeBackoffDelay, sleep, toError } from "@stigmer/react-core/internal";
import {
  closeOAuthPopup,
  openOAuthPopup,
  popupBlockedError,
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
 * console's callback page, which hands the result to Stigmer for the app
 * that started the sign-in to collect; `desktop` is the same page handing it
 * on to the desktop app; `loopback` is a page the desktop app serves on this
 * machine.
 */
export type SignInReturnTo =
  | { readonly kind: "web" }
  | { readonly kind: "desktop" }
  | { readonly kind: "loopback"; readonly port: number };

/**
 * The progress of a popup sign-in. `awaiting-callback` lasts until the
 * sign-in is saved: the ask that finds the login page's answer also finishes
 * it, so a popup sign-in passes from there to `done`. `completing` is the
 * phase of a flow that finishes with a code it holds itself.
 */
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

/**
 * The `completeSignIn` input: with the code a page of the caller's own
 * received, or with none to collect the answer the callback page handed
 * back.
 */
export function completeSignInInput(state: string, code = "") {
  return create(CompleteSignInInputSchema, { state, code });
}

/**
 * The reason `completeSignIn` refuses a sign-in that is unknown, expired or
 * already finished with (FAILED_PRECONDITION, a `google.rpc.ErrorInfo` of
 * domain "stigmer.ai"): it is over, start it again.
 */
export const SIGN_IN_ENDED = "SIGN_IN_ENDED";

/** How long a sign-in asks every second before it settles to every two: a person signing in usually takes less. */
const ASK_QUICKLY_FOR_MS = 30_000;
const QUICK_ASK_MS = 1_000;
const SETTLED_ASK_MS = 2_000;

/**
 * Asks the server until a started sign-in is finished (`completeSignIn`
 * with no code): it answers pending until the callback page has handed
 * back the login page's answer, then saves the login in the same ask.
 *
 * Ends on the saved login, on the server's refusal (the login page's own,
 * or a sign-in that expired after its ten minutes: the server's life of a
 * sign-in governs, not a clock here), or with an `AbortError` when `signal`
 * aborts. A transient failure (a dropped connection, a server restarting:
 * `isTransientStreamError`) is retried with full-jitter backoff and never
 * ends the wait. A failure that is not transient ends it, with one reading:
 * the ask that found the answer takes the sign-in, so a refusal with the
 * reason {@link SIGN_IN_ENDED} right after a failed ask (a token exchange the
 * login server refused answers UNAVAILABLE) means that ask took it, and its
 * failure is the one reported.
 *
 * @param now - The clock; injectable so tests need not wait.
 */
export async function awaitSignIn(
  stigmer: Pick<Stigmer, "vault">,
  state: string,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<CompleteSignInOutput> {
  const began = now();
  let failedInARow = 0;
  let lastFailure: unknown;
  for (;;) {
    try {
      const answer = await stigmer.vault.completeSignIn(completeSignInInput(state));
      if (signal.aborted) throw new AbortError();
      if (!answer.pending) return answer;
      failedInARow = 0;
      lastFailure = undefined;
      await sleep(now() - began < ASK_QUICKLY_FOR_MS ? QUICK_ASK_MS : SETTLED_ASK_MS, signal);
    } catch (err) {
      if (err instanceof AbortError || signal.aborted) throw new AbortError();
      if (lastFailure !== undefined && getErrorReason(err)?.reason === SIGN_IN_ENDED) throw lastFailure;
      if (!isTransientStreamError(err)) throw err;
      failedInARow += 1;
      lastFailure = err;
      await sleep(computeBackoffDelay(failedInARow, { baseDelayMs: QUICK_ASK_MS, maxDelayMs: 10_000 }), signal);
    }
  }
}

/** The error a cancelled sign-in settles with. */
function signInCancelledError(): Error {
  return new Error("The sign-in was cancelled.");
}

/**
 * Runs a sign-in in a popup the caller opened: starts it, sends the popup
 * to the login page, and asks the server until it is finished
 * ({@link awaitSignIn}). The callback page closes the popup when it can.
 *
 * @param onPhase - Told each phase as it begins.
 * @param onDispose - Receives a function that cancels the wait and closes the popup.
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
  popup.location.href = checkedLoginPageUrl(started.authorizationUrl);
  onPhase("awaiting-callback");
  const cancel = new AbortController();
  onDispose(() => {
    cancel.abort();
    closeOAuthPopup(popup);
  });
  try {
    return await awaitSignIn(stigmer, started.state, cancel.signal);
  } catch (err) {
    throw err instanceof AbortError ? signInCancelledError() : err;
  }
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
  /**
   * Clears the error and cancels a sign-in in progress: the wait ends and
   * the popup closes. A sign-in left in a closed window waits for the
   * server's ten minutes otherwise, so a surface that shows the wait offers
   * this as its Cancel.
   */
  readonly clearError: () => void;
}

/**
 * Behavior hook for a sign-in at an address, in a popup.
 *
 * @example
 * ```tsx
 * function SignInAgainButton({ onSignedIn }: { onSignedIn: () => void }) {
 *   const signIn = useVaultSignIn();
 *   return (
 *     <button onClick={() => signIn.signIn("https://mcp.linear.app/mcp", { org: "acme" }).then(onSignedIn)}>
 *       Sign in again
 *     </button>
 *   );
 * }
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
