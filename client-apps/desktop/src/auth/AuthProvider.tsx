import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open } from "@tauri-apps/plugin-shell";
import {
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  generateVerifier,
  generateChallenge,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
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
 * The redirect URI for the PKCE callback, handled via the `stigmer://`
 * deep link scheme registered in tauri.conf.json.
 *
 * Auth0 redirects the system browser to this URL after login. The OS
 * dispatches it to the running Tauri app via the deep-link plugin.
 */
const CALLBACK_URL = "stigmer://auth/callback";

const LOGOUT_RETURN_URL = "stigmer://auth/logout";

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
 * 2. **PKCE auth** (cloud) — opens the system browser for Auth0 login,
 *    receives the authorization code via `stigmer://auth/callback` deep
 *    link, exchanges it for tokens, and manages silent refresh.
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
    clearTokens();
    setTokens(null);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);

    const logoutUrl = new URL(`${AUTH0_DOMAIN}/v2/logout`);
    logoutUrl.searchParams.set("client_id", AUTH0_CLIENT_ID);
    logoutUrl.searchParams.set("returnTo", LOGOUT_RETURN_URL);
    open(logoutUrl.toString()).catch(() => {});
  }, []);

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
// Deep-link auth callback
// ---------------------------------------------------------------------------

/**
 * Opens the system browser for Auth0 login, then waits for the
 * `stigmer://auth/callback` deep link to arrive with the authorization
 * code. Ensures the deep link listener is registered before the browser
 * is opened to avoid a race.
 */
async function openAuthFlow(
  authUrl: string,
  expectedState: string,
): Promise<{ code: string }> {
  let onUrl: ((urls: string[]) => void) | null = null;

  const resultPromise = new Promise<{ code: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      onUrl = null;
      reject(new Error("Authentication timed out"));
    }, CALLBACK_TIMEOUT_MS);

    onUrl = (urls: string[]) => {
      for (const raw of urls) {
        const parsed = parseCallbackUrl(raw);
        if (!parsed) continue;

        onUrl = null;
        clearTimeout(timer);

        if (parsed.error) {
          reject(
            new Error(
              parsed.errorDescription ?? `Auth failed: ${parsed.error}`,
            ),
          );
        } else if (parsed.state !== expectedState) {
          reject(new Error("OAuth state mismatch"));
        } else {
          resolve({ code: parsed.code! });
        }
        return;
      }
    };
  });

  const unlisten = await onOpenUrl((urls) => onUrl?.(urls));

  try {
    await open(authUrl);
    return await resultPromise;
  } finally {
    unlisten();
  }
}

interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Parse a `stigmer://auth/callback?…` deep link URL. Returns null for
 * URLs that do not match the auth callback pattern.
 */
function parseCallbackUrl(raw: string): CallbackParams | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "stigmer:") return null;
  if (url.hostname !== "auth" || url.pathname !== "/callback") return null;

  return {
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
    errorDescription:
      url.searchParams.get("error_description") ?? undefined,
  };
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
