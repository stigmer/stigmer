import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  generateVerifier,
  generateChallenge,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  revokeRefreshToken,
  type StoredTokens,
} from "./pkce";
import { loadTokens, saveTokens, clearTokens, isExpired } from "./token-store";

export interface AuthState {
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly user: AuthUser | null;
  readonly getAccessToken: () => string | null;
  readonly login: () => Promise<void>;
  readonly logout: () => void;
}

export interface AuthUser {
  readonly sub: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * The redirect URI for the PKCE callback. Auth0 redirects the auth
 * webview to this URL after login. The Rust `on_navigation` handler
 * intercepts the redirect, extracts the authorization code, and emits
 * an `auth-callback` event — the webview never actually navigates here.
 */
const CALLBACK_URL = "stigmer://auth/callback";

const CALLBACK_TIMEOUT_MS = 5 * 60_000;

/**
 * Whether auth is disabled (local/OSS mode).
 *
 * When the API URL is localhost and no Auth0 override is set, auth is
 * bypassed entirely — the app behaves as if always authenticated.
 */
function isAuthDisabled(): boolean {
  const apiUrl =
    import.meta.env.VITE_STIGMER_API_URL ?? "http://localhost:7234";
  const forceAuth = import.meta.env.VITE_STIGMER_FORCE_AUTH === "true";
  if (forceAuth) return false;
  try {
    const url = new URL(apiUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return true;
  }
}

/**
 * Desktop auth provider with PKCE support.
 *
 * Supports two modes:
 *
 * 1. **Disabled auth** (local/OSS) — always authenticated, no token.
 *    Mirrors the web's `DisabledAuthProvider`.
 *
 * 2. **PKCE auth** (cloud) — opens Auth0's Universal Login in an
 *    embedded webview window, intercepts the callback redirect to
 *    capture the authorization code, exchanges it for tokens, and
 *    manages silent refresh.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (isAuthDisabled()) {
    return <DisabledAuthProvider>{children}</DisabledAuthProvider>;
  }
  return <PkceAuthProvider>{children}</PkceAuthProvider>;
}

function DisabledAuthProvider({ children }: { children: ReactNode }) {
  const getAccessToken = useCallback(() => null, []);
  const login = useCallback(async () => {}, []);
  const logout = useCallback(() => {}, []);

  const state: AuthState = {
    isAuthenticated: true,
    isLoading: false,
    user: null,
    getAccessToken,
    login,
    logout,
  };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

function PkceAuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<StoredTokens | null>(() => loadTokens());
  const [isLoading, setIsLoading] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAuthenticated = tokens !== null && !isExpired(tokens);

  const getAccessToken = useCallback(() => {
    return tokens?.accessToken ?? null;
  }, [tokens]);

  useEffect(() => {
    if (!tokens?.refreshToken || !tokens.expiresAt) return;

    const msUntilExpiry = tokens.expiresAt - Date.now() - 5 * 60_000;
    if (msUntilExpiry <= 0) {
      refreshAccessToken(tokens.refreshToken)
        .then((newTokens) => {
          saveTokens(newTokens);
          setTokens(newTokens);
        })
        .catch(() => {
          clearTokens();
          setTokens(null);
        });
      return;
    }

    refreshTimer.current = setTimeout(async () => {
      try {
        const newTokens = await refreshAccessToken(tokens.refreshToken!);
        saveTokens(newTokens);
        setTokens(newTokens);
      } catch {
        clearTokens();
        setTokens(null);
      }
    }, msUntilExpiry);

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [tokens]);

  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      const verifier = generateVerifier();
      const challenge = await generateChallenge(verifier);
      const stateParam = generateVerifier(32);

      const authUrl = buildAuthorizeUrl({
        codeChallenge: challenge,
        state: stateParam,
        redirectUri: CALLBACK_URL,
      });

      const { code } = await openAuthFlow(authUrl, stateParam);

      const newTokens = await exchangeCode({
        code,
        codeVerifier: verifier,
        redirectUri: CALLBACK_URL,
      });

      saveTokens(newTokens);
      setTokens(newTokens);
    } catch (err) {
      console.error("Login failed:", err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    const refreshToken = tokens?.refreshToken;

    clearTokens();
    setTokens(null);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);

    if (refreshToken) {
      revokeRefreshToken(refreshToken).catch(() => {});
    }
  }, [tokens]);

  const user: AuthUser | null = tokens
    ? parseIdTokenClaims(tokens.idToken)
    : null;

  const state: AuthState = {
    isAuthenticated,
    isLoading,
    user,
    getAccessToken,
    login,
    logout,
  };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Embedded auth webview
// ---------------------------------------------------------------------------

interface AuthCallbackPayload {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/**
 * Opens Auth0's Universal Login in an embedded Tauri webview window and
 * waits for the authorization code.
 *
 * The Rust `open_auth_window` command creates a secondary window that
 * navigates to the Auth0 authorize URL. When Auth0 redirects to
 * `stigmer://auth/callback`, the Rust `on_navigation` handler
 * intercepts the redirect, emits an `auth-callback` event with the
 * code/state/error, and closes the window.
 *
 * If the user closes the window before completing login, an
 * `auth-cancelled` event is emitted and the promise rejects silently
 * (the login screen stays visible with no error toast).
 */
async function openAuthFlow(
  authUrl: string,
  expectedState: string,
): Promise<{ code: string }> {
  const unlisteners: Array<() => void> = [];

  const cleanup = () => {
    for (const fn of unlisteners) fn();
    unlisteners.length = 0;
  };

  return new Promise<{ code: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Authentication timed out"));
    }, CALLBACK_TIMEOUT_MS);

    const settle = (
      result: { ok: true; code: string } | { ok: false; error: Error },
    ) => {
      clearTimeout(timer);
      cleanup();
      if (result.ok) {
        resolve({ code: result.code });
      } else {
        reject(result.error);
      }
    };

    Promise.all([
      listen<AuthCallbackPayload>("auth-callback", (event) => {
        const { code, state, error, error_description } = event.payload;
        if (error) {
          settle({
            ok: false,
            error: new Error(error_description ?? `Auth failed: ${error}`),
          });
        } else if (state !== expectedState) {
          settle({ ok: false, error: new Error("OAuth state mismatch") });
        } else if (code) {
          settle({ ok: true, code });
        } else {
          settle({
            ok: false,
            error: new Error("No authorization code received"),
          });
        }
      }),
      listen("auth-cancelled", () => {
        settle({ ok: false, error: new LoginCancelledError() });
      }),
    ])
      .then(([unlistenCallback, unlistenCancel]) => {
        unlisteners.push(unlistenCallback, unlistenCancel);
        return invoke("open_auth_window", { authUrl });
      })
      .catch((err) => {
        settle({
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
  });
}

/**
 * Sentinel error thrown when the user closes the auth window without
 * completing login. The login screen catches this and suppresses the
 * error display — closing is intentional cancellation, not a failure.
 */
class LoginCancelledError extends Error {
  constructor() {
    super("Login cancelled");
    this.name = "LoginCancelledError";
  }
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/**
 * Decode basic claims from a JWT ID token (no verification — the token
 * was received directly from Auth0 over HTTPS).
 */
function parseIdTokenClaims(idToken?: string): AuthUser | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return {
      sub: payload.sub ?? "",
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch {
    return null;
  }
}
