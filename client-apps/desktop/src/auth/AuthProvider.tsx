import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
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
 * The redirect URI used for the PKCE callback.
 *
 * In local/dev mode, we use a localhost callback that the CLI also uses.
 * The callback page is served by a minimal local HTTP server (when the
 * Rust backend is ready) or handled via `window.open` + polling.
 *
 * For the MVP, we use a popup window approach: the auth page opens in a
 * new window, and the callback URL is intercepted by polling.
 */
const CALLBACK_PORT = "8088";
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/auth/callback`;

/**
 * Whether auth is disabled (local/OSS mode).
 *
 * When the API URL is localhost and no Auth0 override is set, auth is
 * bypassed entirely — the app behaves as if always authenticated.
 */
function isAuthDisabled(): boolean {
  const apiUrl = import.meta.env.VITE_STIGMER_API_URL ?? "http://localhost:9090";
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
 * 2. **PKCE auth** (cloud) — opens system browser for Auth0 login,
 *    receives callback with authorization code, exchanges for tokens,
 *    stores securely, and manages refresh.
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

  // Schedule token refresh before expiry
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
      const state = generateVerifier(32);

      const authUrl = buildAuthorizeUrl({
        codeChallenge: challenge,
        state,
        redirectUri: CALLBACK_URL,
      });

      // Open system browser for authentication.
      // In Tauri, we use `window.__TAURI__?.shell?.open(authUrl)` when available,
      // otherwise fall back to window.open.
      const tauri = (window as any).__TAURI__;
      if (tauri?.shell?.open) {
        await tauri.shell.open(authUrl);
      } else {
        window.open(authUrl, "_blank");
      }

      // Wait for callback. The callback server (Rust) will post a message.
      // For now, we listen for a `storage` event on a well-known key
      // (the callback page writes the code to localStorage).
      const result = await waitForCallback(state);

      const newTokens = await exchangeCode({
        code: result.code,
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

const CALLBACK_STORAGE_KEY = "stigmer:auth:callback";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Wait for the OAuth callback by polling localStorage.
 *
 * The local callback server (Rust backend or a fallback HTML page) writes
 * `{ code, state }` to `localStorage[CALLBACK_STORAGE_KEY]`. We poll
 * via the `storage` event for cross-tab communication.
 */
function waitForCallback(
  expectedState: string,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("storage", handler);
      clearTimeout(timer);
      localStorage.removeItem(CALLBACK_STORAGE_KEY);
    };

    const handler = (e: StorageEvent) => {
      if (e.key !== CALLBACK_STORAGE_KEY || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue);
        if (data.state !== expectedState) {
          cleanup();
          reject(new Error("OAuth state mismatch"));
          return;
        }
        if (data.error) {
          cleanup();
          reject(new Error(`Auth failed: ${data.error}`));
          return;
        }
        cleanup();
        resolve({ code: data.code });
      } catch {
        cleanup();
        reject(new Error("Invalid callback data"));
      }
    };

    window.addEventListener("storage", handler);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Authentication timed out"));
    }, CALLBACK_TIMEOUT_MS);
  });
}

/**
 * Decode basic claims from a JWT ID token (no verification — the token
 * was received directly from Auth0 over HTTPS).
 */
function parseIdTokenClaims(idToken?: string): AuthUser | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
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
