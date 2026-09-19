/**
 * Where an MCP server's OAuth Sign in comes back to, on a server that was
 * not told.
 *
 * `STIGMER_OAUTH_REDIRECT_URI` is the callback URL the McpServer OAuth
 * Connect flows hand the vendor's login server; the cloud sets it to its
 * console's callback page. A local install (`stigmer up`, the desktop app,
 * the all-in-one image) never set it, and `initiateOAuthConnect` refuses
 * without it, so every Sign in surface the console offers was dead on a
 * local install. The posture that already decides how a served console
 * signs its users in (`trusted-local` when no issuer is configured) answers
 * this too: a server that serves the console on its unified port is
 * reached by a browser on the machine it runs on, so its callback is the
 * console's callback page at `http://localhost:<port>`, the same host the
 * config already assumes for `SKILL_TRANSFER_BASE_URL`.
 *
 * The rules, in order: a configured value always wins; a server that
 * serves no console derives nothing (the CLI and the SDKs need no
 * callback, and today's warn and refusal stand); a server whose port is
 * not yet known (an ephemeral `0`, the test harness's shape) derives
 * nothing either. The console's callback route is the web app's
 * `app/auth/oauth/callback/page.tsx`; its path is a constant here because
 * this is the one place the server names it.
 *
 * Proven by __tests__/oauth-redirect-uri.test.ts.
 */

/** The console's OAuth callback page, relative to the served console's origin. */
export const CONSOLE_OAUTH_CALLBACK_PATH = "/auth/oauth/callback";

export type OAuthRedirectUriResolution =
  /** The operator's value, as configured. */
  | { readonly kind: "configured"; readonly uri: string }
  /** Derived from the served console's own origin. */
  | { readonly kind: "derived"; readonly uri: string }
  /** Nothing to hand the login server; initiate refuses with the pinned copy. */
  | { readonly kind: "absent" };

export interface OAuthRedirectUriInputs {
  /** `STIGMER_OAUTH_REDIRECT_URI` as loaded; empty when unset. */
  readonly configured: string;
  /** Whether this server serves the web console on its unified port. */
  readonly servesConsole: boolean;
  /** The port the unified listener binds; 0 means "not known until listen". */
  readonly port: number;
}

/** The callback URL the McpServer OAuth flows use, and where it came from. */
export function resolveOAuthRedirectUri(inputs: OAuthRedirectUriInputs): OAuthRedirectUriResolution {
  if (inputs.configured !== "") return { kind: "configured", uri: inputs.configured };
  if (!inputs.servesConsole || inputs.port === 0) return { kind: "absent" };
  return { kind: "derived", uri: `http://localhost:${inputs.port}${CONSOLE_OAUTH_CALLBACK_PATH}` };
}
