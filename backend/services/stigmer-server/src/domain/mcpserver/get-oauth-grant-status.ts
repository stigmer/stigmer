/**
 * getOAuthGrantStatus — whether the authenticated user has a sign-in saved
 * at the MCP server's address in their own My vault in the given org
 * (sign-in-connection.ts), the login a run of that server would use. It
 * answers with the sign-in's metadata (expiry, auth method, connection
 * health) and never a token. The console renders the sign-in state of the
 * MCP server page and the session composer from it. A pasted login is no
 * sign-in and reads NO_GRANT here; it and a sign-in saved into a shared
 * vault are read through the vault's own RPCs.
 *
 * Health: a sign-in that does not expire or has not expired is HEALTHY;
 * an expired one is REFRESHABLE when a refresh token is saved with it and
 * EXPIRED when none is; no such sign-in is NO_GRANT. The expiry buffer is
 * the renewal's (domain/vault/sign-in/refresh.ts), so the signal matches
 * what a run will do. A server that does not exist answers NOT_FOUND after
 * the lane's own authorization has spoken.
 *
 * Proven by mcpserver-oauth.conformance.test.ts
 * (CONFORMANCE_TARGET=local) and __tests__/sign-in-connection.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type {
  GetOAuthGrantStatusInput,
  GetOAuthGrantStatusOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import {
  GetOAuthGrantStatusOutputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import type { VaultConnection } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { McpServerConnectDeps } from "./connect.js";
import { signInExpired } from "../vault/sign-in/refresh.js";
import { findCallerSignIn } from "./sign-in-connection.js";

export async function getOAuthGrantStatus(
  deps: McpServerConnectDeps,
  input: GetOAuthGrantStatusInput,
  identity: CallerIdentity,
): Promise<GetOAuthGrantStatusOutput> {
  if (input.resourceId === "") {
    throw invalidArgumentError("resource_id is required");
  }
  if (input.org === "") {
    throw invalidArgumentError("org is required");
  }
  // The login read is the caller's in this organization.
  refuseBoundElsewhere(identity, input.org);
  // The annotation's can_view check (validate → authorize, the Java
  // McpServerGetOAuthGrantStatusHandler order — no load step).
  await authorizeDirect(
    McpServerQueryController.method.getOAuthGrantStatus,
    deps.authorizer,
    identity,
    input,
  );

  const { server, connection } = await findCallerSignIn(
    deps,
    input.resourceId,
    input.org,
    identity,
  );
  if (connection === undefined) {
    return create(GetOAuthGrantStatusOutputSchema, {
      connected: false,
      connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    });
  }

  return create(GetOAuthGrantStatusOutputSchema, {
    connected: true,
    accessTokenExpiresAt: connection.signIn?.expiresAt ?? 0n,
    targetEnvVar: server.spec?.auth?.targetEnvVar ?? "",
    authMethod: connection.signIn?.authMethod ?? "",
    connectionHealth: evaluateHealth(connection),
  });
}

/**
 * The health of a saved login from what the vault holds about it (Go
 * evaluateHealth, over the connection's sign-in record); a login with no
 * expiring sign-in record is HEALTHY. The refresh token is read only for
 * presence: the stored value is sealed and never leaves.
 */
export function evaluateHealth(connection: VaultConnection): OAuthConnectionHealth {
  const signIn = connection.signIn;
  if (
    connection.source !== VaultConnectionSource.sign_in ||
    signIn === undefined ||
    !signInExpired(signIn.expiresAt)
  ) {
    return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY;
  }
  if (signIn.refreshToken !== "") {
    return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE;
  }
  return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
}
