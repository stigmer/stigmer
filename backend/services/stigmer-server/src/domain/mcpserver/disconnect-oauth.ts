/**
 * disconnectOAuth — tear down the caller's own sign-in for an MCP server:
 * every connection in their My vault in the org that a sign-in to this
 * server saved (sign-in-connection.ts), removed with its access and
 * refresh tokens through the vault's atomic entry write, which destroys
 * their sealed backing state. A pasted login, another server's sign-in at
 * the same address, a sign-in saved into a shared vault (removed through
 * that vault's removeConnections) and other people's logins are
 * untouched. The server row is not read, so a sign-in left at the
 * server's earlier address goes too, and so does one whose server was
 * deleted wherever the can_connect check still passes (trusted local);
 * an enforcing authorizer answers NOT_FOUND for a deleted server first,
 * and My vault's removeConnections removes that sign-in instead.
 *
 * Idempotent: no saved sign-in answers disconnected=false without error —
 * race conditions, retries and desired-state semantics all rely on it.
 *
 * Proven by mcpserver-oauth.conformance.test.ts (guards + no-login
 * idempotence, CONFORMANCE_TARGET=local),
 * mcpserver-connect.conformance.test.ts (teardown,
 * CONFORMANCE_TARGET=local-execution) and __tests__/sign-in-vault.test.ts.
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
import { findCallerSignIns } from "./sign-in-connection.js";

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

  const { vault, signIns } = await findCallerSignIns(
    deps,
    resourceId,
    org,
    identity,
  );
  if (vault === undefined || signIns.length === 0) {
    deps.logger.debug("No saved sign-in to disconnect", {
      resource_id: resourceId,
      org,
    });
    return create(DisconnectOAuthOutputSchema, { disconnected: false });
  }

  const { removed } = await deps.vaults.removeConnections(
    vault.metadata?.id ?? "",
    signIns.map((signIn) => signIn.address),
    identity,
  );

  deps.logger.info("OAuth connection disconnected", {
    resource_id: resourceId,
    org,
    removed: removed.length,
  });

  return create(DisconnectOAuthOutputSchema, { disconnected: removed.length > 0 });
}
