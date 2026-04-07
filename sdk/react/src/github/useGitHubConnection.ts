"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSecretValueInputSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";

const STORAGE_KEY_STATE = "stigmer:github:oauth-state";
const GITHUB_USER_API = "https://api.github.com/user";
const GITHUB_TOKEN_KEY = "GITHUB_TOKEN";

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
  /** Display name, or `null` when the user has not set one. */
  readonly name: string | null;
}

/** Options for {@link UseGitHubConnectionReturn.connect}. */
export interface GitHubConnectOptions {
  /**
   * When `true`, open the OAuth authorization page in a popup window
   * instead of redirecting the current page. The callback page signals
   * success via `postMessage` and the hook re-reconciles the token
   * from the personal environment — keeping the user on the same page.
   *
   * Falls back to redirect if the popup is blocked by the browser.
   *
   * @default false
   */
  readonly popup?: boolean;
}

/** Return value of {@link useGitHubConnection}. */
export interface UseGitHubConnectionReturn {
  /** Whether a valid GitHub token exists. */
  readonly isConnected: boolean;
  /** Whether the connection state is being validated on mount. */
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
  /** The connected GitHub user profile, if connected. */
  readonly user: GitHubUser | null;
  /** The current access token (null if not connected). */
  readonly token: string | null;
  /** Initiate the OAuth flow — redirect or popup based on options. */
  readonly connect: (
    redirectUri: string,
    options?: GitHubConnectOptions,
  ) => Promise<void>;
  /** Handle the OAuth callback — exchange code for token. */
  readonly handleCallback: (
    code: string,
    state: string,
    redirectUri: string,
  ) => Promise<void>;
  /** Clear the stored token and user info. */
  readonly disconnect: () => void;
}

async function fetchGitHubUser(token: string): Promise<GitHubUser | null> {
  try {
    const resp = await fetch(GITHUB_USER_API, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      login: data.login,
      avatarUrl: data.avatar_url,
      name: data.name ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Checks whether the personal environment's redacted data contains a given key.
 * The key is present even when the value is redacted (`***REDACTED***`).
 */
function personalEnvHasKey(
  env: { spec?: { data?: Record<string, unknown> } } | null,
  key: string,
): boolean {
  return env?.spec?.data != null && key in env.spec.data;
}

/**
 * Behavior hook that manages the GitHub OAuth connection lifecycle.
 *
 * Handles the full OAuth flow: generating the authorize URL via the
 * Stigmer backend, exchanging the code for a token, validating it,
 * and persisting it in the user's server-side personal
 * `Environment`.
 *
 * **Storage strategy:** The token is stored encrypted in the personal
 * environment (server-side). On OAuth callback the token is written
 * directly to the personal environment via `getOrCreate` /
 * `addVariables`. On subsequent mounts the token is revealed from the
 * personal environment and validated against the GitHub API.
 *
 * Pass `null` as `org` to disable server-side storage (the hook will
 * report as not connected until org context is available).
 *
 * Platform builders who need custom GitHub integration UI use this
 * hook directly. The styled `WorkspaceEditor` component accepts the
 * return value as a prop.
 *
 * @param org - The active organization slug. Required for server-side
 *   token storage. Pass `null` to skip all server operations.
 *
 * @example
 * ```tsx
 * function GitHubConnect({ org }: { org: string }) {
 *   const gh = useGitHubConnection(org);
 *
 *   if (gh.isLoading) return <Skeleton />;
 *
 *   if (!gh.isConnected) {
 *     return (
 *       <button
 *         onClick={() => gh.connect(window.location.href, { popup: true })}
 *         disabled={gh.isConnecting}
 *       >
 *         {gh.isConnecting ? "Connecting…" : "Connect GitHub"}
 *       </button>
 *     );
 *   }
 *
 *   return (
 *     <div>
 *       <img src={gh.user?.avatarUrl} alt={gh.user?.login} />
 *       <span>{gh.user?.login}</span>
 *       <button onClick={gh.disconnect}>Disconnect</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useGitHubConnection(
  org: string | null,
): UseGitHubConnectionReturn {
  const stigmer = useStigmer();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const personalEnv = usePersonalEnvironment(org || null);

  const personalEnvRef = useRef(personalEnv);
  personalEnvRef.current = personalEnv;

  const reconciled = useRef(false);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Synchronously reset loading state when org changes so callers
  // (like the callback page) see the correct value in the same
  // render — not deferred to the next render via an effect.
  const [prevOrg, setPrevOrg] = useState(org);
  if (org !== prevOrg) {
    setPrevOrg(org);
    setIsLoading(!!org);
    reconciled.current = false;
  }

  // ── Server reconciliation ────────────────────────────────────────────
  // Runs once after the personal environment finishes loading.
  // If GITHUB_TOKEN exists in the personal env, reveals it and sets
  // React state. If the revealed token is invalid, cleans it up.
  // If no token exists, marks the hook as not connected.
  useEffect(() => {
    if (!org || personalEnv.isLoading) return;

    if (reconciled.current) return;
    reconciled.current = true;

    const env = personalEnv.environment;
    const hasServerToken = personalEnvHasKey(env, GITHUB_TOKEN_KEY);

    if (!hasServerToken || !env) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function reveal() {
      try {
        const result = await stigmer.environment.getSecretValue(
          create(EnvironmentSecretValueInputSchema, {
            environmentId: env!.metadata!.id,
            key: GITHUB_TOKEN_KEY,
          }),
        );
        if (cancelled) return;

        const serverToken = result.value;
        if (serverToken) {
          const u = await fetchGitHubUser(serverToken);
          if (cancelled) return;
          if (u) {
            setToken(serverToken);
            setUser(u);
          } else {
            try {
              await personalEnvRef.current.removeVariables([
                GITHUB_TOKEN_KEY,
              ]);
            } catch {
              // Best-effort cleanup.
            }
            setToken(null);
            setUser(null);
          }
        }
      } catch {
        // getSecretValue failed — leave state as-is.
      }

      if (!cancelled) setIsLoading(false);
    }

    reveal();
    return () => {
      cancelled = true;
    };
  }, [org, personalEnv.isLoading, personalEnv.environment, stigmer]);

  // ── Popup OAuth message listener ──────────────────────────────────────
  // Listens for success signals from the OAuth callback page running
  // in a popup window. On success, triggers re-reconciliation from the
  // personal environment (where the popup already persisted the token).
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

      // Re-reconcile: the popup persisted the token server-side, so
      // refetch the personal environment and let the reconciliation
      // effect reveal and validate it.
      setIsLoading(true);
      reconciled.current = false;
      personalEnvRef.current.refetch();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Clean up popup resources on unmount.
  useEffect(() => {
    return () => {
      if (popupPollRef.current) {
        clearInterval(popupPollRef.current);
      }
    };
  }, []);

  const connect = useCallback(
    async (redirectUri: string, options?: GitHubConnectOptions) => {
      const { authorizeUrl, state } =
        await stigmer.github.getOAuthAuthorizeUrl({ redirectUri });

      sessionStorage.setItem(STORAGE_KEY_STATE, state);

      if (!options?.popup) {
        window.location.href = authorizeUrl;
        return;
      }

      // If a popup is already open, bring it to focus.
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
        }
      }, POPUP_CLOSE_POLL_MS);
      popupPollRef.current = pollId;
    },
    [stigmer],
  );

  const handleCallback = useCallback(
    async (code: string, state: string, redirectUri: string) => {
      const savedState = sessionStorage.getItem(STORAGE_KEY_STATE);
      if (savedState && savedState !== state) {
        throw new Error("OAuth state mismatch — possible CSRF attack");
      }
      sessionStorage.removeItem(STORAGE_KEY_STATE);

      const { accessToken } = await stigmer.github.exchangeOAuthCode({
        code,
        state,
        redirectUri,
      });

      const tokenVar = {
        [GITHUB_TOKEN_KEY]: { value: accessToken, isSecret: true },
      };
      const env = await personalEnvRef.current.getOrCreate(tokenVar);
      if (!personalEnvHasKey(env, GITHUB_TOKEN_KEY)) {
        await personalEnvRef.current.addVariables(tokenVar);
      }

      setToken(accessToken);

      const u = await fetchGitHubUser(accessToken);
      setUser(u);
    },
    [stigmer],
  );

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY_STATE);
    setToken(null);
    setUser(null);

    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    if (popupPollRef.current) {
      clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
    setIsConnecting(false);

    const env = personalEnvRef.current.environment;
    if (env && personalEnvHasKey(env, GITHUB_TOKEN_KEY)) {
      personalEnvRef.current
        .removeVariables([GITHUB_TOKEN_KEY])
        .catch(() => {});
    }
  }, []);

  return {
    isConnected: token !== null,
    isLoading,
    isConnecting,
    popupBlocked,
    user,
    token,
    connect,
    handleCallback,
    disconnect,
  };
}
