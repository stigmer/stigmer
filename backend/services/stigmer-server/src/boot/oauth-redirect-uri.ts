/**
 * Where an MCP server's OAuth Sign in comes back to, on a server that was
 * not told.
 *
 * `STIGMER_OAUTH_REDIRECT_URI` is the callback URL the McpServer OAuth
 * Connect flows hand the vendor's login server; the cloud sets it to its
 * console's callback page. A local install (`stigmer up`, the desktop app,
 * the all-in-one image) never set it, and `initiateOAuthConnect` refuses
 * without it, so every Sign in surface the console offers was dead on a
 * local install. A server that serves the console on its unified port knows
 * where that console is: the callback is the console's callback page on the
 * origin browsers reach the unified port on.
 *
 * That origin is `SKILL_TRANSFER_BASE_URL` when the operator named one. The
 * team shapes fill it from the address they were told clients reach the
 * server on (Compose's `STIGMER_PUBLIC_URL`, the chart's `server.publicUrl`
 * or its Ingress API host), and the console is served on that same origin,
 * so its callback page is there too. Unnamed, the server is reached by a
 * browser on the machine it runs on (`stigmer up`, the desktop app, the
 * all-in-one image), and the origin is `http://localhost:<port>`, the host
 * the skill transfer lane derives on (boot/skill-transfer-origin.ts). Before
 * the public origin was read here, a Compose or Helm console reached over
 * the network sent its operator's browser to their own localhost
 * (stigmer#1200).
 *
 * The rules, in order: a configured value always wins; a server that
 * serves no console derives nothing (the CLI and the SDKs need no
 * callback, and today's warn and refusal stand); a named public origin
 * derives the callback on it, whatever the port; a known port derives it on
 * localhost; a server whose port is not yet known (an ephemeral `0`, the
 * test harness's shape) derives nothing. The console's callback route is
 * the web app's `client-apps/web/src/app/auth/oauth/callback/page.tsx`; its
 * path is a constant here because this is the one place the server names
 * it.
 *
 * Proven by __tests__/oauth-redirect-uri.test.ts and the MCP OAuth callback
 * case of __tests__/compose.test.ts.
 */

/** The console's OAuth callback page, relative to the served console's origin. */
export const CONSOLE_OAUTH_CALLBACK_PATH = "/auth/oauth/callback";

/** Which origin a derived callback was rendered on. */
export type DerivedOAuthRedirectOrigin =
  /** The operator's `SKILL_TRANSFER_BASE_URL`: the unified port's public origin. */
  | "public-origin"
  /** The unified port on localhost: a browser on the server's own machine. */
  | "loopback";

export type OAuthRedirectUriResolution =
  /** The operator's value, as configured. */
  | { readonly kind: "configured"; readonly uri: string }
  /** Derived from the served console's own origin. */
  | {
      readonly kind: "derived";
      readonly uri: string;
      readonly from: DerivedOAuthRedirectOrigin;
    }
  /** Nothing to hand the login server; initiate refuses with the pinned copy. */
  | { readonly kind: "absent" };

export interface OAuthRedirectUriInputs {
  /** `STIGMER_OAUTH_REDIRECT_URI` as loaded; empty when unset. */
  readonly configured: string;
  /** Whether this server serves the web console on its unified port. */
  readonly servesConsole: boolean;
  /** `SKILL_TRANSFER_BASE_URL` as loaded: the unified port's public origin; empty when unset. */
  readonly publicOrigin: string;
  /** The port the unified listener binds; 0 means "not known until listen". */
  readonly port: number;
}

/** The callback URL the McpServer OAuth flows use, and where it came from. */
export function resolveOAuthRedirectUri(
  inputs: OAuthRedirectUriInputs,
): OAuthRedirectUriResolution {
  if (inputs.configured !== "")
    return { kind: "configured", uri: inputs.configured };
  if (!inputs.servesConsole) return { kind: "absent" };
  if (inputs.publicOrigin !== "") {
    return {
      kind: "derived",
      uri: `${trimTrailingSlash(inputs.publicOrigin)}${CONSOLE_OAUTH_CALLBACK_PATH}`,
      from: "public-origin",
    };
  }
  if (inputs.port === 0) return { kind: "absent" };
  return {
    kind: "derived",
    uri: `http://localhost:${inputs.port}${CONSOLE_OAUTH_CALLBACK_PATH}`,
    from: "loopback",
  };
}

/** An origin written `https://host/` names the same origin as `https://host` (the skill lane's join). */
function trimTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}
