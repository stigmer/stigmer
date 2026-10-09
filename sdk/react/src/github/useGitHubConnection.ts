"use client";

/**
 * The GitHub connection lifecycle, with no token in the page.
 *
 * Connecting GitHub is the vault's sign-in at the address `github.com`
 * (vault/useVaultSignIn.ts): the server finds GitHub's login (the
 * organization's own app for the address, else Stigmer's built-in one),
 * exchanges the code and saves the token as the `github.com` login in the
 * person's My vault, describing it by the account ("GitHub @octocat").
 * "Connected" means My vault holds that login. Every repository read
 * (listing, search, branches, trees, files) goes through the server's GitHub
 * query RPCs, which use the saved login server-side; runs clone with it too.
 * Nothing here reads a token or calls api.github.com.
 *
 * In a browser the sign-in runs in a popup on the console's callback page.
 * A desktop shell that cannot open popups passes `openUrl` and a
 * `returnTo` (the console's page handing the result to the app, or the
 * app's own loopback page) and hands the code and state back through
 * {@link UseGitHubConnectionReturn.handleCallback}.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { useMyVault } from "../vault/useMyVault.js";
import { GITHUB_HOST } from "../vault/address.js";
import { toError } from "../internal/toError.js";
import { checkedLoginPageUrl } from "../internal/loginPageUrl.js";
import { SESSION_REFUSED_MESSAGE, canKeepInSession } from "../internal/sessionKeeping.js";
import { closeOAuthPopup, openOAuthPopup } from "../internal/oauthPopup.js";
import {
  completeSignInInput,
  runPopupSignIn,
  startSignInInput,
  type SignInReturnTo,
} from "../vault/useVaultSignIn.js";

const STORAGE_KEY_STATE = "stigmer:github:sign-in-state";

/** Minimal GitHub user profile for display. */
export interface GitHubUser {
  /** GitHub username (e.g. `"octocat"`). */
  readonly login: string;
  /** URL of the user's avatar image. */
  readonly avatarUrl: string;
  /** Display name, or `null` when it is not known. */
  readonly name: string | null;
}

/**
 * Optional configuration for {@link useGitHubConnection}, for a desktop or
 * other non-browser shell where the sign-in cannot run in a popup.
 */
export interface UseGitHubConnectionConfig {
  /**
   * Opens the login page in the system browser instead of a popup. With it,
   * `connect()` records the sign-in and opens the page; the shell receives
   * the code and state (a deep link or its loopback page) and calls
   * {@link UseGitHubConnectionReturn.handleCallback}.
   */
  readonly openUrl?: (url: string) => void | Promise<void>;
  /**
   * Where GitHub's login page sends the person back to when `openUrl` is
   * set: `desktop` (the console's callback page hands the result to the
   * app) or `loopback` with the app's own port. Ignored without `openUrl`.
   */
  readonly returnTo?: SignInReturnTo;
}

/** Return value of {@link useGitHubConnection}. */
export interface UseGitHubConnectionReturn {
  /** Whether My vault holds a `github.com` login. */
  readonly isConnected: boolean;
  /** Whether My vault is being read on mount. */
  readonly isLoading: boolean;
  /** Whether a sign-in is in progress. */
  readonly isConnecting: boolean;
  /**
   * Whether the last `connect()` was blocked by the browser's popup
   * blocker. When `true`, the UI should ask the person to allow popups and
   * try again.
   */
  readonly popupBlocked: boolean;
  /** The last sign-in's failure, or `null`. */
  readonly connectError: Error | null;
  /**
   * The connected GitHub account, read from the saved login's description.
   * `null` when not connected or not known.
   */
  readonly user: GitHubUser | null;
  /**
   * The organization the GitHub reads go through (its My vault holds the
   * login): set while connected, `null` otherwise. Pass it to
   * {@link useGitHubRepos}, {@link useGitHubSearch},
   * {@link useGitHubTreeLister} and {@link useGitHubFileReader}.
   */
  readonly readOrg: string | null;
  /**
   * Sign in to GitHub. **Call it from a synchronous click handler**: in a
   * browser the popup opens before any await.
   */
  readonly connect: () => Promise<void>;
  /**
   * Finish a sign-in a shell received outside the page (`openUrl` flows):
   * the server exchanges the code and saves the login.
   */
  readonly handleCallback: (code: string, state: string) => Promise<void>;
  /** Re-read My vault. */
  readonly reconcile: () => void;
  /** Remove the `github.com` login from My vault. */
  readonly disconnect: () => void;
  /**
   * The last disconnect that failed to remove the login: My vault still
   * holds it, so the hook still reports connected. `null` once a later
   * disconnect starts, or when none failed.
   */
  readonly disconnectError: Error | null;
}

function userFor(login: string): GitHubUser {
  return {
    login,
    avatarUrl: `https://github.com/${encodeURIComponent(login)}.png`,
    name: null,
  };
}

/**
 * Behavior hook that manages the GitHub connection lifecycle.
 *
 * Pass `null` as `org` to disable (the hook reports not connected).
 *
 * @param org - The active organization id (a slug is also accepted).
 * @param config - Optional configuration for desktop / non-browser
 *   environments. See {@link UseGitHubConnectionConfig}.
 *
 * @example
 * ```tsx
 * function GitHubConnect({ org }: { org: string }) {
 *   const gh = useGitHubConnection(org);
 *   if (gh.isLoading) return <Skeleton />;
 *   if (!gh.isConnected) {
 *     return <button onClick={() => void gh.connect()}>Connect GitHub</button>;
 *   }
 *   return <GitHubRepoPicker org={gh.readOrg!} onSelect={addRepo} />;
 * }
 * ```
 *
 * @example Desktop (Tauri): the system browser, the result through a deep link
 * ```tsx
 * const gh = useGitHubConnection(org, {
 *   openUrl: (url) => invoke("open_auth_in_browser", { authUrl: url }),
 *   returnTo: { kind: "desktop" },
 * });
 * // The deep link handler calls gh.handleCallback(code, state).
 * ```
 */
export function useGitHubConnection(
  org: string | null,
  config?: UseGitHubConnectionConfig,
): UseGitHubConnectionReturn {
  const stigmer = useStigmer();
  const myVault = useMyVault(org || null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [connectError, setConnectError] = useState<Error | null>(null);
  const [disconnectError, setDisconnectError] = useState<Error | null>(null);

  const myVaultRef = useRef(myVault);
  myVaultRef.current = myVault;
  const disposeRef = useRef<(() => void) | null>(null);
  // Set when disconnect cancels a popup sign-in: its rejection is no failure.
  const cancelledRef = useRef(false);

  useEffect(() => () => disposeRef.current?.(), []);

  const isConnected = myVault.connectionAddresses.has(GITHUB_HOST);
  const openUrl = config?.openUrl;
  const returnTo = config?.returnTo;

  const connect = useCallback(async () => {
    if (!org) {
      throw new Error("useGitHubConnection: cannot connect GitHub without an organization.");
    }
    setConnectError(null);
    if (openUrl) {
      if (!canKeepInSession()) {
        const refused = new Error(SESSION_REFUSED_MESSAGE);
        setConnectError(refused);
        throw refused;
      }
      setIsConnecting(true);
      try {
        const started = await stigmer.vault.startSignIn(
          startSignInInput(GITHUB_HOST, { org }, returnTo ?? { kind: "desktop" }),
        );
        const loginPage = checkedLoginPageUrl(started.authorizationUrl);
        sessionStorage.setItem(STORAGE_KEY_STATE, started.state);
        await openUrl(loginPage);
      } catch (err) {
        setIsConnecting(false);
        setConnectError(toError(err));
        throw err;
      }
      return;
    }

    disposeRef.current?.();
    const popup = openOAuthPopup();
    if (!popup) {
      setPopupBlocked(true);
      return;
    }
    setPopupBlocked(false);
    setIsConnecting(true);
    cancelledRef.current = false;
    try {
      await runPopupSignIn(stigmer, popup, GITHUB_HOST, { org }, () => {}, (dispose) => {
        disposeRef.current = dispose;
      });
    } catch (err) {
      if (!cancelledRef.current) {
        closeOAuthPopup(popup);
        setConnectError(toError(err));
      }
      cancelledRef.current = false;
      throw err;
    } finally {
      disposeRef.current = null;
      setIsConnecting(false);
      myVaultRef.current.refetch();
    }
  }, [stigmer, org, openUrl, returnTo]);

  const handleCallback = useCallback(
    async (code: string, state: string) => {
      // Every way out, a refusal included, ends the connecting state and
      // re-reads My vault: a sign-in another tab finished shows its login.
      try {
        // The server checks the state too; this window refuses a callback
        // for a sign-in it did not start rather than pass it on.
        const saved = sessionStorage.getItem(STORAGE_KEY_STATE);
        if (!saved) {
          throw new Error(
            "This GitHub sign-in was not started here, or it already finished. Start Connect GitHub again.",
          );
        }
        if (saved !== state) {
          throw new Error("This GitHub sign-in does not match the one started here. Start Connect GitHub again.");
        }
        sessionStorage.removeItem(STORAGE_KEY_STATE);
        await stigmer.vault.completeSignIn(completeSignInInput(state, code));
      } catch (err) {
        setConnectError(toError(err));
        throw err;
      } finally {
        setIsConnecting(false);
        myVaultRef.current.refetch();
      }
    },
    [stigmer],
  );

  const reconcile = useCallback(() => {
    setIsConnecting(false);
    myVaultRef.current.refetch();
  }, []);

  const disconnect = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY_STATE);
    } catch {
      // Storage refused: no sign-in state was kept to forget.
    }
    if (disposeRef.current) {
      cancelledRef.current = true;
      disposeRef.current();
      disposeRef.current = null;
    }
    setIsConnecting(false);
    setDisconnectError(null);
    if (myVaultRef.current.connectionAddresses.has(GITHUB_HOST)) {
      myVaultRef.current
        .removeConnections([GITHUB_HOST])
        .catch((err: unknown) => setDisconnectError(toError(err)));
    }
  }, []);

  // The server saves the login with the account in its description
  // ("GitHub @octocat"), so the account survives a reload and another
  // device.
  const savedDescription =
    myVault.vault?.spec?.connections[GITHUB_HOST]?.description ?? "";
  const savedLogin = /^GitHub @(\S+)$/.exec(savedDescription)?.[1] ?? null;
  const user = useMemo(
    () => (isConnected && savedLogin ? userFor(savedLogin) : null),
    [isConnected, savedLogin],
  );
  const readOrg = isConnected && org ? org : null;

  return useMemo(
    () => ({
      isConnected,
      isLoading: myVault.isLoading,
      isConnecting,
      popupBlocked,
      connectError,
      user,
      readOrg,
      connect,
      handleCallback,
      reconcile,
      disconnect,
      disconnectError,
    }),
    [isConnected, myVault.isLoading, isConnecting, popupBlocked, connectError, user, readOrg, connect, handleCallback, reconcile, disconnect, disconnectError],
  );
}
