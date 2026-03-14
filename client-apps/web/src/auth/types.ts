// ---------------------------------------------------------------------------
// Auth module — core type definitions
//
// These types define the public contract for the auth abstraction. Every
// consumer outside src/auth/ interacts with auth through AuthState (returned
// by useAuth()). The auth mode and provider-specific config are internal
// concerns managed by AuthProvider.
// ---------------------------------------------------------------------------

/**
 * Supported authentication modes.
 *
 * - `disabled` — No authentication. All requests are unauthenticated. Default
 *   for local OSS use via `stigmer server`.
 * - `oidc` — OpenID Connect authentication with a configurable identity
 *   provider. Used for cloud deployments.
 */
export type AuthMode = "disabled" | "oidc";

/**
 * Authenticated user identity.
 *
 * Populated by the auth provider when a user is authenticated via OIDC.
 * `null` in disabled mode (there is no user concept without auth).
 */
export interface AuthUser {
  readonly email: string;
  readonly name?: string;
}

/**
 * Auth state exposed to the application via `useAuth()`.
 *
 * This is the sole public API for auth consumers. Components should never
 * import mode-specific providers, check auth config, or access the token
 * store directly.
 */
export interface AuthState {
  /** Whether the current user is authenticated. Always `true` in disabled mode. */
  readonly isAuthenticated: boolean;

  /** Whether auth state is still being resolved (e.g., OIDC token exchange in progress). */
  readonly isLoading: boolean;

  /** The authenticated user, or `null` in disabled mode / before authentication completes. */
  readonly user: AuthUser | null;

  /** The current access token, or `null` when no token is available (disabled mode, or pre-auth). */
  readonly accessToken: string | null;

  /** Initiate login. No-op in disabled mode. */
  readonly login: () => void;

  /** Initiate logout. No-op in disabled mode. */
  readonly logout: () => void;
}

/**
 * Auth configuration resolved at startup.
 *
 * The `mode` field determines which auth provider implementation is rendered
 * by `AuthProvider`. Additional provider-specific config (e.g., OIDC issuer,
 * client ID) will be added to this type as providers are implemented.
 */
export interface AuthConfig {
  readonly mode: AuthMode;
}
