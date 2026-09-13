/**
 * OIDC provider configuration.
 *
 * Defines the parameters needed to connect to an OpenID Connect identity
 * provider. The values come from the runtime config (`/config.json`): the
 * cloud container's entrypoint writes it from `NEXT_PUBLIC_*` variables;
 * a self-hosted stigmer-server's console lane synthesizes it from
 * `STIGMER_OIDC_ISSUER`, `STIGMER_OIDC_AUDIENCE` and
 * `STIGMER_OIDC_CONSOLE_CLIENT_ID`; `next dev` reads the same
 * `NEXT_PUBLIC_*` variables directly.
 *
 * The provider uses the Authorization Code flow with PKCE (client-side,
 * no server secrets), which is what lets the console ship as a static
 * export and sign in against any standards-compliant issuer.
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
   * Defaults to `/login` on the application's own origin when not
   * specified — the signed-out landing.
   */
  readonly postLogoutRedirectUri?: string;
}
