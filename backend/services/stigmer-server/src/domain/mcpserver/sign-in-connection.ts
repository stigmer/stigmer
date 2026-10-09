/**
 * The caller's own sign-in for an MCP server: the connection in the
 * caller's My vault in an organization saved by a sign-in (`source:
 * sign_in`) at the server's address. The one lookup getOAuthGrantStatus and
 * disconnectOAuth share, so "connected" and "disconnect" always mean the
 * same login, and never a teammate's or a pasted one.
 *
 * A sign-in fills every HTTP tool at its address, whichever tool or page
 * started it, so the address alone finds it. A local program has no
 * address and no sign-in. A sign-in saved into a shared vault is not here;
 * it is managed through that vault's own entry RPCs
 * (VaultCommandController's setConnection and removeConnections).
 */
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { VaultConnection } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { notFoundError } from "../../pipeline/errors.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { toolAddressOf } from "../vault/address.js";
import type { McpServerConnectDeps } from "./connect.js";

/** The caller's sign-in at a server's address, as stored (sealed). */
export interface CallerSignIn {
  /** The server as loaded. */
  readonly server: McpServer;
  /** The caller's My vault in the organization, or undefined before their first save. */
  readonly vault: Vault | undefined;
  /** The server's address; undefined for a local program or a URL with a placeholder. */
  readonly address: string | undefined;
  /** The sign-in saved at the address, or undefined (none, or a pasted login). */
  readonly connection: VaultConnection | undefined;
}

export async function findCallerSignIn(
  deps: Pick<McpServerConnectDeps, "vaults" | "store">,
  mcpServerId: string,
  org: string,
  identity: CallerIdentity,
): Promise<CallerSignIn> {
  // A store fault propagates as itself; the serving chain's error boundary
  // answers it INTERNAL.
  const server: McpServer = await deps.store
    .getResource(ApiResourceKind.mcp_server, mcpServerId, McpServerSchema)
    .catch((error: unknown) => {
      throw error instanceof ResourceNotFoundError
        ? notFoundError("mcp_server", mcpServerId)
        : error;
    });
  const address = toolAddressOf(server);
  const vault: Vault | undefined = await deps.vaults.findMine(org, identity.identityId);
  const connections = vault?.spec?.connections ?? {};
  // Own keys only: an address never names the object's prototype.
  const saved =
    address !== undefined && Object.hasOwn(connections, address) ? connections[address] : undefined;
  const connection = saved?.source === VaultConnectionSource.sign_in ? saved : undefined;
  return { server, vault, address, connection };
}
