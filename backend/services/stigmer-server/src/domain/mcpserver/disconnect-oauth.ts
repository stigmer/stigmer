/**
 * disconnectOAuth — ports
 * pkg/domain/mcpserver/controller/disconnect_oauth.go: tear down a user's
 * OAuth connection for an MCP server. Deletes the OAuthGrant record and
 * its associated managed environment (which holds the access and refresh
 * tokens); the MCP server definition is unchanged.
 *
 * Idempotent: no grant for the (caller, resource_id, org) tuple returns
 * disconnected=false without error — race conditions, retries after
 * partial failures, and desired-state semantics all rely on it.
 *
 * Delete order: managed environment first (eliminates secrets), then
 * grant record (metadata only). If grant deletion fails after environment
 * deletion, the orphaned grant is harmless metadata pointing to a deleted
 * environment.
 *
 * Proven by mcpserver-oauth.conformance.test.ts (guards + no-grant
 * idempotence, CONFORMANCE_TARGET=local-ts) and
 * mcpserver-connect.conformance.test.ts (teardown,
 * CONFORMANCE_TARGET=local-ts-execution).
 */
import { create } from "@bufbuild/protobuf";

import type {
  DisconnectOAuthInput,
  DisconnectOAuthOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { DisconnectOAuthOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";

import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { McpServerConnectDeps } from "./connect.js";

export async function disconnectOAuth(
  deps: McpServerConnectDeps,
  input: DisconnectOAuthInput,
): Promise<DisconnectOAuthOutput> {
  const resourceId = input.resourceId;
  if (resourceId === "") {
    throw invalidArgumentError("resource_id is required");
  }
  const org = input.org;
  if (org === "") {
    throw invalidArgumentError("org is required");
  }

  // OSS mode: single user, empty identity_account_id.
  let grant;
  try {
    grant = await deps.oauthGrants.find("", resourceId, org);
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

  const envId = grant.environmentId;
  if (envId !== "") {
    try {
      await deps.managedEnv.deleteManagedEnvironment(envId);
    } catch (error) {
      deps.logger.warn(
        "Failed to delete managed environment — may already be deleted",
        {
          resource_id: resourceId,
          environment_id: envId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  try {
    await deps.oauthGrants.delete("", resourceId, org);
  } catch (error) {
    throw internalError(error, "failed to delete OAuth grant");
  }

  deps.logger.info("OAuth connection disconnected", {
    resource_id: resourceId,
    org,
    env_deleted: envId !== "",
  });

  return create(DisconnectOAuthOutputSchema, { disconnected: true });
}
