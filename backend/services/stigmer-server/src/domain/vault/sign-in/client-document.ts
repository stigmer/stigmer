/**
 * Stigmer's Client ID Metadata Document: the OAuth client a login server
 * reads when Stigmer signs in with the document's own URL as its client id
 * (the MCP Authorization specification, 2025-11-25, "Client ID Metadata
 * Documents"), so no client is registered with that login server.
 *
 * The document is served at `OAUTH_CLIENT_DOCUMENT_PATH` on the unified
 * port's public origin (transport/oauth-client/lane.ts) and used only when
 * that origin is https (`clientDocumentUrlFor`): a login server fetches the
 * URL itself, and a laptop's localhost is out of its reach. It names
 * Stigmer, every redirect a sign-in may use (the console's callback, the
 * same with the desktop bridge, and the desktop's own loopback page, whose
 * port RFC 8252 section 7.3 lets the login server ignore), and a public
 * client: PKCE, no secret.
 *
 * Proven by __tests__/client-document.test.ts.
 */
import { CONSOLE_OAUTH_CALLBACK_PATH } from "../../../boot/oauth-redirect-uri.js";
import { OAUTH_CLIENT_DOCUMENT_PATH } from "../../../transport/constants.js";
import { CLIENT_NAME } from "./client.js";
import { signInRedirectUri } from "./start.js";

/** The loopback redirect the document lists: the desktop's page, port left to the login server. */
const LOOPBACK_REDIRECT = `http://127.0.0.1${CONSOLE_OAUTH_CALLBACK_PATH}`;

/**
 * The document's URL, which is also the client id: on the public origin
 * when it is https, else "" (no document is offered).
 */
export function clientDocumentUrlFor(publicOrigin: string): string {
  if (!URL.canParse(publicOrigin)) {
    return "";
  }
  const origin = new URL(publicOrigin);
  return origin.protocol === "https:" ? `${origin.origin}${OAUTH_CLIENT_DOCUMENT_PATH}` : "";
}

/** The document, as JSON. */
export function clientDocument(clientDocumentUrl: string, oauthRedirectUri: string): string {
  const redirects =
    oauthRedirectUri === ""
      ? [LOOPBACK_REDIRECT]
      : [
          signInRedirectUri(oauthRedirectUri, { kind: "web" }),
          signInRedirectUri(oauthRedirectUri, { kind: "desktop" }),
          LOOPBACK_REDIRECT,
        ];
  return JSON.stringify({
    client_id: clientDocumentUrl,
    client_name: CLIENT_NAME,
    redirect_uris: redirects,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}
