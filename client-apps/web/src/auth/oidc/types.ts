/**
 * OIDC provider configuration.
 *
 * Defines the parameters needed to connect to an OpenID Connect identity
 * provider. This interface is the contract for the future OIDC auth
 * provider implementation.
 *
 * When OIDC mode is implemented, these values will be sourced from the
 * runtime config endpoint (`/api/config`) served by the Go server, or
 * from `NEXT_PUBLIC_*` environment variables during development.
 *
 * The OIDC provider will use the Authorization Code flow with PKCE
 * (client-side, no server secrets required) to support static export
 * deployment.
 */
export interface OidcConfig {
  /** OIDC issuer URL (e.g., `https://auth.stigmer.com/`). */
  readonly issuer: string;

  /** OAuth 2.0 client ID registered with the identity provider. */
  readonly clientId: string;

  /** API audience identifier for access token scoping. */
  readonly audience: string;

  /**
   * OAuth 2.0 scopes to request.
   * Defaults to `["openid", "email", "profile", "offline_access"]` when
   * not specified.
   */
  readonly scopes?: readonly string[];

  /**
   * URI to redirect to after logout.
   * Defaults to the application's base URL when not specified.
   */
  readonly postLogoutRedirectUri?: string;
}
