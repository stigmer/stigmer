/**
 * The OAuth app client credentials a vendor sign-in refreshes with: the
 * decrypted client secret and the token-endpoint auth method of the
 * OAuthApp the server's `auth.oauth_app_ref` names. Read LIVE (never
 * snapshotted on the grant), so an admin correcting a misconfigured
 * OAuthApp fixes refreshes at once; resolved through the same lookup the
 * initiate path used, so a refresh runs against the credentials the person
 * actually signed in with (stigmer/stigmer#584).
 */
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import type { Logger } from "../../../boot/logger.js";
import type { SecretService } from "../../../encryption/encryption.js";
import type { Store } from "../../../store/interface.js";
import { resolveOAuthAppRef } from "../../oauthapp/refresolution.js";
import { TOKEN_AUTH_METHOD_BASIC, TOKEN_AUTH_METHOD_POST } from "./token.js";

export interface ClientCredentialsDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
}

/** The server's OAuth app client secret and auth method; both empty for a DCR (public) client. */
export async function loadOAuthAppClientCredentials(
  deps: ClientCredentialsDeps,
  mcpServer: McpServer,
): Promise<{ clientSecret: string; tokenAuthMethod: string }> {
  const ref = mcpServer.spec?.auth?.oauthAppRef;
  if (ref === undefined || ref.slug === "") {
    return { clientSecret: "", tokenAuthMethod: "" };
  }

  let app;
  try {
    app = await resolveOAuthAppRef(deps.store, ref, deps.logger);
  } catch (error) {
    throw new Error(
      `failed to list oauth apps: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (app === undefined) {
    throw new Error(`OAuthApp '${ref.slug}' not found`);
  }

  const tokenAuthMethod = tokenAuthMethodFromSpec(
    app.spec?.tokenEndpointAuthMethod ?? TokenEndpointAuthMethod.UNSPECIFIED,
  );

  let secret = app.spec?.clientSecret ?? "";
  if (deps.secretService.isEncrypted(secret)) {
    secret = await deps.secretService.decrypt(secret);
  }
  return { clientSecret: secret, tokenAuthMethod };
}

/**
 * Maps the OAuthAppSpec enum onto the oauth package's RFC 8414 strings.
 * UNSPECIFIED means Basic — every OAuthApp created before the field
 * existed authenticated via HTTP Basic.
 */
export function tokenAuthMethodFromSpec(method: TokenEndpointAuthMethod): string {
  if (method === TokenEndpointAuthMethod.CLIENT_SECRET_POST) {
    return TOKEN_AUTH_METHOD_POST;
  }
  return TOKEN_AUTH_METHOD_BASIC;
}
