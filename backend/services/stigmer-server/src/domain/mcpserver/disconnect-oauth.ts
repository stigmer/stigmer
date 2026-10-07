/**
 * disconnectOAuth: ends one sign-in to an MCP server — the caller's own,
 * or the organization's for a server with organization sign-in (admins
 * only, oauth/sign-in.ts). Deletes the credential holding the access
 * token, then the OAuthGrant with the refresh token sealed on it; the MCP
 * server definition is unchanged, and other people's sign-ins to it are
 * untouched.
 *
 * Idempotent: no grant for the (identity, resource_id, org) tuple returns
 * disconnected=false without error — race conditions, retries after
 * partial failures, and desired-state semantics all rely on it.
 *
 * Delete order: the credential first (it holds the secret), then the
 * grant. The credential's own delete chain also ends a grant that names
 * it, so a failure between the two leaves no live token behind.
 *
 * Proven by mcpserver-oauth.conformance.test.ts (guards + no-grant
 * idempotence, CONFORMANCE_TARGET=local) and
 * mcpserver-connect.conformance.test.ts (teardown,
 * CONFORMANCE_TARGET=local-execution).
 */
import { create } from "@bufbuild/protobuf";

import type {
  DisconnectOAuthInput,
  DisconnectOAuthOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { DisconnectOAuthOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";

import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { McpServerConnectDeps } from "./connect.js";
import {
  requireOrganizationSignInAdmin,
  signInIdentityById,
} from "./oauth/sign-in.js";

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
  // The grant removed is the caller's in this organization.
  refuseBoundElsewhere(identity, org);
  // The annotation's can_connect check (validate → authorize, the Java
  // McpServerDisconnectOAuthHandler order — no load step; on the
  // multi-tenant edition an unresolvable id answers through the
  // authorizer's uniform posture).
  await authorizeDirect(
    McpServerCommandController.method.disconnectOAuth,
    deps.authorizer,
    identity,
    input,
  );

  const { identity: grantIdentity, server } = await signInIdentityById(
    deps.store,
    resourceId,
    identity,
  );
  if (server !== undefined) {
    await requireOrganizationSignInAdmin(deps.authorizer, identity, server, org);
  }

  let grant;
  try {
    grant = await deps.oauthGrants.find(grantIdentity, resourceId, org);
  } catch (error) {
    throw internalError(error, "failed to look up OAuth grant");
  }

  if (grant === undefined) {
    deps.logger.debug("No OAuth grant to disconnect", {
      resource_id: resourceId,
      org,
    });
    return create(DisconnectOAuthOutputSchema, { disconnected: false });
  }

  try {
    await deps.signIns.remove(grant.credentialId);
  } catch (error) {
    throw internalError(error, "failed to delete the sign-in's credential");
  }

  try {
    await deps.oauthGrants.delete(grantIdentity, resourceId, org);
  } catch (error) {
    throw internalError(error, "failed to delete OAuth grant");
  }

  deps.logger.info("OAuth connection disconnected", {
    resource_id: resourceId,
    org,
    credential_id: grant.credentialId,
  });

  return create(DisconnectOAuthOutputSchema, { disconnected: true });
}
