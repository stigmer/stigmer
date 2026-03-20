"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSecretValueInputSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";

const STORAGE_KEY_STATE = "stigmer:github:oauth-state";
const GITHUB_USER_API = "https://api.github.com/user";
const GITHUB_TOKEN_KEY = "GITHUB_TOKEN";

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
 * {@link Environment}.
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
 */
export function useGitHubConnection(
  org: string | null,
): UseGitHubConnectionReturn {
  const stigmer = useStigmer();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const personalEnv = usePersonalEnvironment(org || null);

  const personalEnvRef = useRef(personalEnv);
  personalEnvRef.current = personalEnv;

  const reconciled = useRef(false);

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
    user,
    token,
    connect,
    handleCallback,
    disconnect,
  };
}
