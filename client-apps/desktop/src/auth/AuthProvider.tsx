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
import { toast } from "sonner";
import type { NativeSignIn } from "@stigmer/client";

export interface AuthState {
  /**
   * Whether this server signs people in. Decided by the server's own answer
   * (server/connect.ts), never by its address; the identity gate reads it.
   */
  readonly isAuthEnabled: boolean;
  readonly isAuthenticated: boolean;
  readonly isInitialized: boolean;
  readonly user: AuthUser | null;
  readonly getAccessToken: () => string | null;
  /** Where the server sends people to sign in; null until the host has said, and on a server that signs no one in. */
  readonly provider: ProviderView | null;
  /**
   * Signs in through the announced provider. `providerConfirmed` says the
   * person was shown a provider on another site than the server's and chose
   * it; without it the host refuses such a provider.
   */
  readonly login: (options?: { providerConfirmed?: boolean }) => Promise<void>;
  readonly logout: () => void;
}

export interface AuthUser {
  readonly sub: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

/**
 * The webview's whole view of a session, as the Rust host answers it
 * (src-tauri/src/oidc.rs `SessionView`). The refresh token is not here: it
 * stays in Rust and the system keychain.
 */
export interface SessionView {
  readonly accessToken: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
  readonly user: AuthUser;
  /** False when nothing outlives the app: no keychain answered. */
  readonly keptBetweenLaunches: boolean;
}

/** Where a server sends people to sign in (src-tauri/src/oidc.rs `ProviderView`). */
export interface ProviderView {
  /** The provider's host, as the person will see it in the browser. */
  readonly host: string;
  /** Whether the provider sits on the server's own site. */
  readonly sameSite: boolean;
}

/** What the host answers when the person cancels the wait for the browser. */
export const SIGN_IN_CANCELLED = "Sign-in cancelled.";

/** Where builds before this one kept tokens, in web storage a page script can read. */
const RETIRED_TOKEN_KEY = "stigmer:auth:tokens";

/** How long before expiry the access token is renewed. */
const REFRESH_AHEAD_MS = 5 * 60_000;

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Forgets the tokens an older build kept in web storage. Nothing is carried
 * over: the person signs in again, and the new session lives in the
 * keychain.
 */
export function forgetRetiredTokens(): void {
  try {
    localStorage.removeItem(RETIRED_TOKEN_KEY);
  } catch {
    // Storage the page cannot reach holds nothing to forget.
  }
}

export type AuthProviderProps =
  | {
      /** The server trusts every request: the app is open, with no token. */
      readonly mode: "open";
      readonly children: ReactNode;
    }
  | {
      /** The server signs people in through the provider it announced. */
      readonly mode: "sign-in";
      readonly server: string;
      readonly nativeSignIn: NativeSignIn;
      readonly children: ReactNode;
    };

/**
 * The desktop's sign-in, in one of the two modes the server's answer picks
 * (server/connect.ts):
 *
 * 1. **Open** — the server trusts every request: always signed in, no
 *    token. Mirrors the web console's `DisabledAuthProvider`.
 * 2. **Sign-in** — the Rust host runs the whole flow (src-tauri/src/oidc.rs):
 *    discovery at the announced issuer, PKCE, the person's own browser, the
 *    code exchange, the keychain. The webview holds only the access token
 *    and the person's name, and renews the token before it expires.
 */
export function AuthProvider(props: AuthProviderProps) {
  // Stryker disable next-line ArrayDeclaration: the effect reads nothing from the render, so any dependency list runs it once
  useEffect(forgetRetiredTokens, []);
  if (props.mode === "open") {
    return <AuthContext.Provider value={OPEN_STATE}>{props.children}</AuthContext.Provider>;
  }
  // A new server or provider is a new sign-in state, never a stale one.
  return (
    <NativeAuthProvider
      key={`${props.server} ${props.nativeSignIn.issuer} ${props.nativeSignIn.audience} ${props.nativeSignIn.clientId}`}
      server={props.server}
      nativeSignIn={props.nativeSignIn}
    >
      {props.children}
    </NativeAuthProvider>
  );
}

/** A server that trusts every request: always signed in, no token. */
const OPEN_STATE: AuthState = {
  isAuthEnabled: false,
  isAuthenticated: true,
  isInitialized: true,
  user: null,
  getAccessToken: () => null,
  provider: null,
  login: async () => {},
  logout: () => {},
};

function NativeAuthProvider({
  server,
  nativeSignIn,
  children,
}: {
  server: string;
  nativeSignIn: NativeSignIn;
  children: ReactNode;
}) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // A ref mirrors the session so `getAccessToken` stays referentially
  // stable across refreshes: the Stigmer client, and every hook built on
  // it, is not recreated on each renewal.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const getAccessToken = useCallback(
    () => sessionRef.current?.accessToken ?? null,
    // Stryker disable next-line ArrayDeclaration: the getter reads the ref, never the render, so any dependency list keeps it alike
    [],
  );

  const adopt = useCallback(
    (next: SessionView | null) => {
      setSession(next);
      if (next !== null && !next.keptBetweenLaunches && !import.meta.env.DEV) {
        toast.message("This computer has no keychain the app can use, so you will sign in again next time.", {
          id: "sign-in-not-kept",
        });
      }
    },
    // Stryker disable next-line ArrayDeclaration: the callback reads nothing from the render, so any dependency list keeps it alike
    [],
  );

  // The session the host already holds for this server, if any. An answer
  // that arrives after this provider left (another server) adopts nothing.
  useEffect(
    () => {
      let cancelled = false;
      invoke<SessionView | null>("auth_session", { server, signIn: nativeSignIn })
        .then(
          (found) => {
            if (!cancelled) adopt(found);
          },
          () => {
            // The provider could not be asked: show the sign-in screen, and
            // keep what the keychain holds for the next try.
          },
        )
        .finally(() => setIsInitialized(true));
      return () => {
        cancelled = true;
      };
    },
    // Stryker disable next-line ArrayDeclaration: another server or provider mounts another provider (the key above), so the list never changes while this one lives
    [server, nativeSignIn, adopt],
  );

  // Renew the access token ahead of its expiry; a refused renewal signs out.
  useEffect(() => {
    if (session === null) return;
    const delay = Math.max(0, session.expiresAt - Date.now() - REFRESH_AHEAD_MS);
    const timer = setTimeout(() => {
      invoke<SessionView | null>("auth_refresh", { server }).then(adopt, () => {
        // Unreachable for now: keep the session until it expires.
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [session, server, adopt]);

  // Where this server sends people, so the sign-in screen can name a
  // provider on another site before the browser opens.
  const [provider, setProvider] = useState<ProviderView | null>(null);
  useEffect(
    () => {
      let cancelled = false;
      invoke<ProviderView>("auth_provider", { server, signIn: nativeSignIn }).then(
        (answer) => {
          if (!cancelled) setProvider(answer);
        },
        () => {
          // The host always answers; a failure leaves no sign-in offered.
        },
      );
      return () => {
        cancelled = true;
      };
    },
    // Stryker disable next-line ArrayDeclaration: another server or provider mounts another provider (the key above), so the list never changes while this one lives
    [server, nativeSignIn],
  );

  const login = useCallback(
    async (options?: { providerConfirmed?: boolean }) => {
      adopt(
        await invoke<SessionView>("auth_sign_in", {
          server,
          signIn: nativeSignIn,
          providerConfirmed: options?.providerConfirmed ?? false,
        }),
      );
    },
    // Stryker disable next-line ArrayDeclaration: another server or provider mounts another provider, so the list never changes while this one lives
    [server, nativeSignIn, adopt],
  );

  const logout = useCallback(
    () => {
      setSession(null);
      void invoke("auth_sign_out", { server }).catch(() => {});
    },
    // Stryker disable next-line ArrayDeclaration: another server mounts another provider, so the list never changes while this one lives
    [server],
  );

  const state: AuthState = {
    isAuthEnabled: true,
    // Stryker disable next-line EqualityOperator: a token expiring in this very millisecond is a boundary no clock reads twice
    isAuthenticated: session !== null && session.expiresAt > Date.now(),
    isInitialized,
    user: session?.user ?? null,
    getAccessToken,
    provider,
    login,
    logout,
  };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
