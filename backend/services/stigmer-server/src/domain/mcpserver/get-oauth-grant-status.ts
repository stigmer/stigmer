/**
 * getOAuthGrantStatus — whether the authenticated user has a sign-in for
 * the MCP server in their own My vault in the given org that a run would
 * use: one this server made (sign-in-connection.ts), saved at the server's
 * current address, while the server is still the kind (HTTP or a local
 * program) it was at sign-in, the resolver's rule (domain/vault/resolve.ts
 * `madeFor`): a sign-in a run would refuse reads NO_GRANT here. It
 * answers with the sign-in's metadata (expiry, auth method, connection
 * health) and never a token. The console renders the OAuth
 * state of the MCP server page and the session composer from it. A pasted
 * login is no sign-in and reads NO_GRANT here; it and a sign-in saved into
 * a shared vault are read through the vault's own RPCs.
 *
 * Health: a sign-in that does not expire or has not expired is HEALTHY;
 * an expired one is REFRESHABLE when a refresh token is saved with it and
 * EXPIRED when none is; no such sign-in is NO_GRANT. The expiry buffer is
 * the renewal's (oauth/refresh.ts), so the signal matches what a run will
 * do. A server that does not exist answers NOT_FOUND after the lane's own
 * authorization has spoken.
 *
 * Proven by mcpserver-oauth.conformance.test.ts
 * (CONFORMANCE_TARGET=local), __tests__/oauth-handshake.test.ts and
 * __tests__/sign-in-vault.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { invalidArgumentError, notFoundError } from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { toolAddressOf } from "../vault/address.js";
import type { McpServerConnectDeps } from "./connect.js";
import { signInExpired } from "./oauth/refresh.js";
import { findCallerSignIns } from "./sign-in-connection.js";

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

  // A store fault propagates as itself; the serving chain's error boundary
  // answers it INTERNAL.
  const server: McpServer = await deps.store
    .getResource(ApiResourceKind.mcp_server, input.resourceId, McpServerSchema)
    .catch((error: unknown) => {
      throw error instanceof ResourceNotFoundError
        ? notFoundError("mcp_server", input.resourceId)
        : error;
    });
  const address = toolAddressOf(server);
  const localProgram = server.spec?.serverType?.case !== "http";
  const { signIns } = await findCallerSignIns(
    deps,
    input.resourceId,
    input.org,
    identity,
  );
  const connection = signIns.find(
    (signIn) =>
      signIn.address === address &&
      (signIn.connection.signIn?.localProgram === true) === localProgram,
  )?.connection;
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
