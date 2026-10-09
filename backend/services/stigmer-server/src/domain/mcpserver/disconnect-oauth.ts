/**
 * disconnectOAuth — tear down the caller's own sign-in for an MCP server:
 * the connection a sign-in saved at the server's address in their My vault
 * in the org (sign-in-connection.ts), removed with its access and refresh
 * tokens through the vault's atomic entry write, which destroys their
 * sealed backing state. A pasted login at the address, a sign-in saved
 * into a shared vault (removed through that vault's removeConnections) and
 * other people's logins are untouched. Once the server is deleted, it has
 * no address to read: My vault's removeConnections removes the sign-in.
 *
 * Idempotent: no saved sign-in answers disconnected=false without error —
 * race conditions, retries and desired-state semantics all rely on it.
 *
 * Proven by mcpserver-oauth.conformance.test.ts (guards + no-login
 * idempotence, CONFORMANCE_TARGET=local),
 * mcpserver-connect.conformance.test.ts (teardown,
 * CONFORMANCE_TARGET=local-execution) and ../vault/sign-in/__tests__/person.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type {
  DisconnectOAuthInput,
  DisconnectOAuthOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { DisconnectOAuthOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { McpServerConnectDeps } from "./connect.js";
import { findCallerSignIn } from "./sign-in-connection.js";

export async function disconnectOAuth(
  deps: McpServerConnectDeps,
  input: DisconnectOAuthInput,
  identity: CallerIdentity,
): Promise<DisconnectOAuthOutput> {
  const resourceId = input.resourceId;
  if (resourceId === "") {
    throw invalidArgumentError("resource_id is required");
  }
  const org = input.org;
  if (org === "") {
    throw invalidArgumentError("org is required");
  }
  // The login removed is the caller's in this organization.
  refuseBoundElsewhere(identity, org);
  // The annotation's can_connect check (validate → authorize, the Java
  // McpServerDisconnectOAuthHandler order — no load step).
  await authorizeDirect(
    McpServerCommandController.method.disconnectOAuth,
    deps.authorizer,
    identity,
    input,
  );

  const { vault, address, connection } = await findCallerSignIn(
    deps,
    resourceId,
    org,
    identity,
  );
  if (vault === undefined || address === undefined || connection === undefined) {
    deps.logger.debug("No saved sign-in to disconnect", {
      resource_id: resourceId,
      org,
    });
    return create(DisconnectOAuthOutputSchema, { disconnected: false });
  }

  const { removed } = await deps.vaults.removeConnections(
    vault.metadata?.id ?? "",
    [address],
    identity,
  );

  deps.logger.info("OAuth connection disconnected", {
    resource_id: resourceId,
    org,
    removed: removed.length,
  });

  return create(DisconnectOAuthOutputSchema, { disconnected: removed.length > 0 });
}
