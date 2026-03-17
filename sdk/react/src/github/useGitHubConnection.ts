"use client";

import { useCallback, useEffect, useState } from "react";
import { useStigmer } from "../hooks";

const STORAGE_KEY_TOKEN = "stigmer:github:token";
const STORAGE_KEY_STATE = "stigmer:github:oauth-state";
const GITHUB_USER_API = "https://api.github.com/user";

/** Minimal GitHub user profile for display. */
export interface GitHubUser {
  readonly login: string;
  readonly avatarUrl: string;
  readonly name: string | null;
}

export interface UseGitHubConnectionReturn {
  /** Whether a valid GitHub token exists. */
  readonly isConnected: boolean;
  /** Whether the connection state is being validated on mount. */
  readonly isLoading: boolean;
  /** The connected GitHub user profile, if connected. */
  readonly user: GitHubUser | null;
  /** The current access token (null if not connected). */
  readonly token: string | null;
  /** Initiate the OAuth flow by redirecting to GitHub. */
  readonly connect: (redirectUri: string) => Promise<void>;
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
 * Behavior hook that manages the GitHub OAuth connection lifecycle.
 *
 * Handles the full OAuth flow: generating the authorize URL via the
 * Stigmer backend, exchanging the code for a token, storing the token
 * in localStorage, and validating it on mount.
 *
 * Platform builders who need custom GitHub integration UI use this
 * hook directly. The styled `WorkspaceEditor` component accepts the
 * return value as a prop.
 */
export function useGitHubConnection(): UseGitHubConnectionReturn {
  const stigmer = useStigmer();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    fetchGitHubUser(stored).then((u) => {
      if (cancelled) return;
      if (u) {
        setToken(stored);
        setUser(u);
      } else {
        localStorage.removeItem(STORAGE_KEY_TOKEN);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(
    async (redirectUri: string) => {
      const { authorizeUrl, state } =
        await stigmer.github.getOAuthAuthorizeUrl({ redirectUri });

      sessionStorage.setItem(STORAGE_KEY_STATE, state);
      window.location.href = authorizeUrl;
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

      localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
      setToken(accessToken);

      const u = await fetchGitHubUser(accessToken);
      setUser(u);
    },
    [stigmer],
  );

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    sessionStorage.removeItem(STORAGE_KEY_STATE);
    setToken(null);
    setUser(null);
  }, []);

  return {
    isConnected: token !== null,
    isLoading,
    user,
    token,
    connect,
    handleCallback,
    disconnect,
  };
}
