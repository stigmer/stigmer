"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSecretValueInputSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";

const STORAGE_KEY_TOKEN = "stigmer:github:token";
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
 * environment (server-side). On mount the hook reads from localStorage
 * first for instant UX, then reconciles with the server. Tokens found
 * only in localStorage are migrated to the personal environment and
 * removed from localStorage.
 *
 * Pass `null` as `org` to fall back to localStorage-only behavior
 * (useful during initial app load before org context is available).
 *
 * Platform builders who need custom GitHub integration UI use this
 * hook directly. The styled `WorkspaceEditor` component accepts the
 * return value as a prop.
 *
 * @param org - The active organization slug. Required for server-side
 *   token storage. Pass `null` to use localStorage-only mode.
 */
export function useGitHubConnection(
  org: string | null,
): UseGitHubConnectionReturn {
  const stigmer = useStigmer();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const personalEnv = usePersonalEnvironment(org || null);

  // Ref to the personal env hook so async callbacks always see the latest
  // state without being recreated on every render.
  const personalEnvRef = useRef(personalEnv);
  personalEnvRef.current = personalEnv;

  // Track whether the reconciliation effect has run to avoid double-migration.
  const reconciled = useRef(false);

  // ── Phase 1: Instant localStorage read ──────────────────────────────
  // Provides zero-latency provisional state while the personal env loads.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (!stored) {
      // No localStorage token. If there's no org (so no server check
      // will happen), we're done loading.
      if (!org) setIsLoading(false);
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
      // If no org, this is the only source — mark loading done.
      // With org, Phase 2 will finalize loading after reconciliation.
      if (!org) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // Only on mount (org is captured but we don't re-run on org change;
    // the reconciliation effect handles that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase 2: Server reconciliation ──────────────────────────────────
  // Runs when the personal environment finishes loading. Handles:
  //   Case A: Token in server + localStorage → clear localStorage
  //   Case B: Token in server only → reveal and use it
  //   Case C: Token in localStorage only → migrate to server
  //   Case D: Neither → not connected
  useEffect(() => {
    if (!org || personalEnv.isLoading) return;

    // Prevent re-running if we've already reconciled for this org.
    if (reconciled.current) return;
    reconciled.current = true;

    const env = personalEnv.environment;
    const hasServerToken = personalEnvHasKey(env, GITHUB_TOKEN_KEY);
    const localToken = localStorage.getItem(STORAGE_KEY_TOKEN);

    let cancelled = false;

    async function reconcile() {
      if (hasServerToken && env) {
        // Cases A & B: Server has the token. Reveal it.
        localStorage.removeItem(STORAGE_KEY_TOKEN);
        try {
          const result = await stigmer.environment.getSecretValue(
            create(EnvironmentSecretValueInputSchema, {
              environmentId: env.metadata!.id,
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
              // Server token is invalid — clean it up.
              try {
                await personalEnvRef.current.removeVariables([
                  GITHUB_TOKEN_KEY,
                ]);
              } catch {
                // Best-effort cleanup; don't block the user.
              }
              setToken(null);
              setUser(null);
            }
          }
        } catch {
          // getSecretValue failed (permissions, network, etc.).
          // Fall through — Phase 1 may have set a provisional token.
        }
      } else if (localToken) {
        // Case C: Token in localStorage only → migrate to server.
        // Pass the token as initialData so a newly created env includes it
        // in a single call. If the env already existed, getOrCreate returns
        // it unchanged and we add the variable explicitly.
        try {
          const tokenVar = {
            [GITHUB_TOKEN_KEY]: { value: localToken, isSecret: true },
          };
          const created = await personalEnvRef.current.getOrCreate(tokenVar);
          if (cancelled) return;
          if (!personalEnvHasKey(created, GITHUB_TOKEN_KEY)) {
            await personalEnvRef.current.addVariables(tokenVar);
            if (cancelled) return;
          }
          localStorage.removeItem(STORAGE_KEY_TOKEN);
        } catch {
          // Migration failed — keep localStorage token as fallback.
          // It will be retried on next mount.
        }
      }
      // Case D: Neither source → no action needed.

      if (!cancelled) setIsLoading(false);
    }

    reconcile();
    return () => {
      cancelled = true;
    };
  }, [org, personalEnv.isLoading, personalEnv.environment, stigmer]);

  // Reset reconciliation flag when org changes so we re-reconcile.
  useEffect(() => {
    reconciled.current = false;
  }, [org]);

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

      // Stage in localStorage. The next page mount will migrate it to
      // the personal environment during reconciliation (Phase 2).
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

    // Remove from personal environment (fire-and-forget).
    const env = personalEnvRef.current.environment;
    if (env && personalEnvHasKey(env, GITHUB_TOKEN_KEY)) {
      personalEnvRef.current
        .removeVariables([GITHUB_TOKEN_KEY])
        .catch(() => {
          // Best-effort server cleanup. localStorage is already cleared,
          // so next mount won't find the token in either source.
        });
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
