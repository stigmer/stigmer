"use client";

/**
 * The GitHub connection lifecycle, with no token in the page.
 *
 * Connecting runs GitHub's OAuth flow; the server exchanges the code and
 * saves the token as the `github.com` login in the person's My vault, and
 * answers with the account's login only. "Connected" means My vault holds
 * that login. Every repository read (listing, search, branches, trees,
 * files) goes through the server's GitHub query RPCs, which use the saved
 * login server-side; runs clone with it too. Nothing here reads a token or
 * calls api.github.com.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { useMyVault } from "../vault/useMyVault.js";
import { GITHUB_HOST } from "../vault/address.js";
import { toError } from "../internal/toError.js";

const STORAGE_KEY_STATE = "stigmer:github:oauth-state";

/** Message type sent from the OAuth callback popup to the opener. */
export const GITHUB_CALLBACK_MESSAGE_TYPE = "stigmer:github:callback-success";

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;
const POPUP_CLOSE_POLL_MS = 500;

/** Minimal GitHub user profile for display. */
export interface GitHubUser {
  /** GitHub username (e.g. `"octocat"`). */
  readonly login: string;
  /** URL of the user's avatar image. */
  readonly avatarUrl: string;
  /** Display name, or `null` when it is not known. */
  readonly name: string | null;
}

/** Options for {@link UseGitHubConnectionReturn.connect}. */
export interface GitHubConnectOptions {
  /**
   * When `true`, open the OAuth authorization page in a popup window
   * instead of redirecting the current page. The callback page signals
   * success via `postMessage` and the hook re-reads My vault — keeping
   * the user on the same page.
   *
   * Falls back to redirect if the popup is blocked by the browser.
   *
   * @default false
   */
  readonly popup?: boolean;
}

/**
 * Optional configuration for {@link useGitHubConnection}.
 *
 * Enables desktop and non-browser environments to participate in the
 * GitHub OAuth flow without relying on `window.open()` popups.
 */
export interface UseGitHubConnectionConfig {
  /**
   * Custom function to open the authorization URL in a browser.
   *
   * When provided, the hook calls this instead of `window.open()` during
   * popup-mode `connect()` flows. This enables desktop environments
   * (e.g. Tauri, Electron) where webview popups are blocked but the
   * system browser is available.
   *
   * When used with {@link callbackUrl}, the callback page processes the
   * token exchange and the consumer calls {@link UseGitHubConnectionReturn.reconcile}
   * to pick up the saved login from My vault.
   *
   * When used without {@link callbackUrl} (e.g. localhost callback server),
   * the consumer calls {@link UseGitHubConnectionReturn.handleCallback}
   * with the code, state, and redirect URI to complete the exchange.
   */
  readonly openUrl?: (url: string) => void | Promise<void>;

  /**
   * Override the OAuth callback URL.
   *
   * When provided, this replaces the `redirectUri` parameter passed to
   * `connect()` by UI components like `WorkspaceEditor`. Use this to
   * route the GitHub callback to a specific URL — for example, the
   * Stigmer web console's callback page for desktop flows, or a
   * localhost server for local development.
   *
   * When the callback page handles the token exchange itself (cloud
   * desktop flows), the consumer triggers re-reconciliation via
   * {@link UseGitHubConnectionReturn.reconcile} after the callback
   * completes externally.
   *
   * When the consumer handles the exchange (localhost flows), the same
   * URL must be passed to `handleCallback()` — GitHub requires an
   * exact match between the authorize and exchange redirect URIs.
   */
  readonly callbackUrl?: string;
}

/** Return value of {@link useGitHubConnection}. */
export interface UseGitHubConnectionReturn {
  /** Whether My vault holds a `github.com` login. */
  readonly isConnected: boolean;
  /** Whether My vault is being read on mount. */
  readonly isLoading: boolean;
  /** Whether an OAuth popup is open and the flow is in progress. */
  readonly isConnecting: boolean;
  /**
   * Whether the last popup `connect()` attempt was blocked by the
   * browser. When `true`, the UI should prompt the user to allow
   * popups or offer a redirect fallback (call `connect` without
   * `{ popup: true }`).
   */
  readonly popupBlocked: boolean;
  /**
   * The connected GitHub account, when this browser saw it connect (the
   * server returns the login on the exchange). `null` when not connected
   * or not known here.
   */
  readonly user: GitHubUser | null;
  /**
   * The organization the GitHub reads go through (its My vault holds the
   * login): set while connected, `null` otherwise. Pass it to
   * {@link useGitHubRepos}, {@link useGitHubSearch},
   * {@link useGitHubTreeLister} and {@link useGitHubFileReader}.
   */
  readonly readOrg: string | null;
  /** Initiate the OAuth flow — redirect or popup based on options. */
  readonly connect: (
    redirectUri: string,
    options?: GitHubConnectOptions,
  ) => Promise<void>;
  /** Handle the OAuth callback — the server exchanges the code and saves the login. */
  readonly handleCallback: (
    code: string,
    state: string,
    redirectUri: string,
  ) => Promise<void>;
  /**
   * Re-read My vault. Call this when the exchange was handled elsewhere
   * (e.g. by the web callback page during a desktop OAuth flow).
   */
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
 * Reads the OAuth state from the opener window's sessionStorage when
 * running inside a popup (same-origin). Falls back to the current
 * window's sessionStorage for redirect-based flows or when the
 * opener is unavailable.
 */
function getSavedOAuthState(): string | null {
  try {
    if (window.opener && !window.opener.closed) {
      const openerState = window.opener.sessionStorage.getItem(
        STORAGE_KEY_STATE,
      );
      if (openerState) return openerState;
    }
  } catch {
    // Cross-origin or closed opener — fall through to local storage.
  }
  return sessionStorage.getItem(STORAGE_KEY_STATE);
}

/**
 * Removes the OAuth state key from both the current window's and the
 * opener's sessionStorage (best-effort).
 */
function clearOAuthState(): void {
  sessionStorage.removeItem(STORAGE_KEY_STATE);
  try {
    window.opener?.sessionStorage?.removeItem(STORAGE_KEY_STATE);
  } catch {
    // Cross-origin or closed opener — ignore.
  }
}

/**
 * Behavior hook that manages the GitHub connection lifecycle.
 *
 * Handles the OAuth flow: the authorize URL from the Stigmer backend,
 * then the exchange, which the server completes by saving the token as
 * the `github.com` login in the caller's My vault in `org`. The token
 * never reaches the page.
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
 *     return (
 *       <button onClick={() => gh.connect(window.location.href, { popup: true })}>
 *         Connect GitHub
 *       </button>
 *     );
 *   }
 *   return <GitHubRepoPicker org={gh.readOrg!} onSelect={addRepo} />;
 * }
 * ```
 *
 * @example Desktop (Tauri) — open in system browser, callback via deep link
 * ```tsx
 * const gh = useGitHubConnection(org, {
 *   openUrl: (url) => invoke("open_auth_in_browser", { authUrl: url }),
 *   callbackUrl: "https://app.stigmer.ai/auth/github/callback?source=desktop",
 * });
 * // The web callback page completes the exchange; the desktop deep link
 * // handler calls gh.reconcile() to re-read My vault.
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
  const [login, setLogin] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<Error | null>(null);

  const myVaultRef = useRef(myVault);
  myVaultRef.current = myVault;

  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [prevOrg, setPrevOrg] = useState(org);
  if (org !== prevOrg) {
    setPrevOrg(org);
    setLogin(null);
  }

  const isConnected = myVault.connectionAddresses.has(GITHUB_HOST);

  // ── Popup OAuth message listener ──────────────────────────────────────
  // The callback page in the popup already had the server save the login;
  // re-read My vault to see it.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== GITHUB_CALLBACK_MESSAGE_TYPE) return;

      if (popupPollRef.current) {
        clearInterval(popupPollRef.current);
        popupPollRef.current = null;
      }
      popupRef.current = null;
      setIsConnecting(false);
      const sentLogin = typeof event.data?.login === "string" ? event.data.login : null;
      if (sentLogin) setLogin(sentLogin);
      myVaultRef.current.refetch();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    return () => {
      if (popupPollRef.current) {
        clearInterval(popupPollRef.current);
      }
    };
  }, []);

  const connect = useCallback(
    async (redirectUri: string, options?: GitHubConnectOptions) => {
      if (!org) {
        throw new Error("useGitHubConnection: cannot connect GitHub without an organization.");
      }
      const effectiveRedirectUri = config?.callbackUrl ?? redirectUri;

      const { authorizeUrl, state } =
        await stigmer.github.getOAuthAuthorizeUrl({
          redirectUri: effectiveRedirectUri,
          org,
        });

      sessionStorage.setItem(STORAGE_KEY_STATE, state);

      if (!options?.popup) {
        window.location.href = authorizeUrl;
        return;
      }

      if (config?.openUrl) {
        setIsConnecting(true);
        await config.openUrl(authorizeUrl);
        return;
      }

      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.focus();
        return;
      }

      const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
      const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
      const popup = window.open(
        authorizeUrl,
        "stigmer-github-auth",
        `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},popup=yes`,
      );

      if (!popup || popup.closed) {
        setPopupBlocked(true);
        return;
      }
      setPopupBlocked(false);

      setIsConnecting(true);
      popupRef.current = popup;

      const pollId = setInterval(() => {
        if (!popup.closed) return;
        clearInterval(pollId);
        if (popupPollRef.current === pollId) {
          popupPollRef.current = null;
          popupRef.current = null;
          setIsConnecting(false);
          // The callback page may have completed the exchange (e.g. a
          // cross-origin popup flow): re-read My vault to see the login.
          myVaultRef.current.refetch();
        }
      }, POPUP_CLOSE_POLL_MS);
      popupPollRef.current = pollId;
    },
    [stigmer, org, config?.openUrl, config?.callbackUrl],
  );

  const handleCallback = useCallback(
    async (code: string, state: string, redirectUri: string) => {
      // Every way out, a refusal included, ends the connecting state and
      // re-reads My vault: a sign-in another tab finished shows its login.
      try {
        // The server checks the state too; this browser refuses a callback
        // for a sign-in it did not start rather than pass it on.
        const savedState = getSavedOAuthState();
        if (!savedState) {
          throw new Error(
            "This GitHub sign-in was not started here, or it already finished. Start Connect GitHub again.",
          );
        }
        if (savedState !== state) {
          throw new Error("OAuth state mismatch — possible CSRF attack");
        }
        clearOAuthState();
        if (!org) {
          throw new Error("useGitHubConnection: cannot connect GitHub without an organization.");
        }

        const result = await stigmer.github.exchangeOAuthCode({
          code,
          state,
          redirectUri,
          org,
        });
        setLogin(result.login || null);
      } finally {
        setIsConnecting(false);
        myVaultRef.current.refetch();
      }
    },
    [stigmer, org],
  );

  const reconcile = useCallback(() => {
    setIsConnecting(false);
    myVaultRef.current.refetch();
  }, []);

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY_STATE);
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    if (popupPollRef.current) {
      clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
    setIsConnecting(false);
    setLogin(null);
    setDisconnectError(null);
    if (myVaultRef.current.connectionAddresses.has(GITHUB_HOST)) {
      myVaultRef.current
        .removeConnections([GITHUB_HOST])
        .catch((err: unknown) => setDisconnectError(toError(err)));
    }
  }, [org]);

  // The server saves the login with the account in its description
  // ("GitHub @octocat"), so the account survives a reload and another
  // device; the browser's memory is the fallback for an older save.
  const savedDescription =
    myVault.vault?.spec?.connections[GITHUB_HOST]?.description ?? "";
  const savedLogin = /^GitHub @(\S+)$/.exec(savedDescription)?.[1] ?? null;
  const shownLogin = savedLogin ?? login;
  const user = useMemo(
    () => (isConnected && shownLogin ? userFor(shownLogin) : null),
    [isConnected, shownLogin],
  );
  const readOrg = isConnected && org ? org : null;

  return useMemo(
    () => ({
      isConnected,
      isLoading: myVault.isLoading,
      isConnecting,
      popupBlocked,
      user,
      readOrg,
      connect,
      handleCallback,
      reconcile,
      disconnect,
      disconnectError,
    }),
    [isConnected, myVault.isLoading, isConnecting, popupBlocked, user, readOrg, connect, handleCallback, reconcile, disconnect, disconnectError],
  );
}
