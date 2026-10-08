/**
 * The caller's own sign-ins for an MCP server: the connections in the
 * caller's My vault in an organization that a sign-in to that server saved
 * (`source: sign_in` and `sign_in.mcp_server_id` the server's id). The one
 * lookup getOAuthGrantStatus and disconnectOAuth share, so "connected" and
 * "disconnect" always mean the same logins, and never a teammate's, a
 * pasted login, or another server's sign-in at the same address.
 *
 * The lookup needs no server row: a sign-in names the server that made it,
 * so the caller can still remove it once the server is deleted. A sign-in
 * saved into a shared vault is not here; it is managed through that
 * vault's own entry RPCs (VaultCommandController's setConnection and
 * removeConnections).
 */
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { VaultConnection } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import type { McpServerConnectDeps } from "./connect.js";

/** One of the caller's sign-ins for the server, as stored (sealed). */
export interface CallerSignIn {
  readonly address: string;
  readonly connection: VaultConnection;
}

export interface CallerSignIns {
  /** The caller's My vault in the organization, or undefined before their first save. */
  readonly vault: Vault | undefined;
  /** Every sign-in for the server in it, one per address it was saved at. */
  readonly signIns: readonly CallerSignIn[];
}

export async function findCallerSignIns(
  deps: Pick<McpServerConnectDeps, "vaults">,
  mcpServerId: string,
  org: string,
  identity: CallerIdentity,
): Promise<CallerSignIns> {
  // A store fault propagates as itself; the serving chain's error boundary
  // answers it INTERNAL.
  const vault: Vault | undefined = await deps.vaults.findMine(org, identity.identityId);
  const signIns: CallerSignIn[] = [];
  if (mcpServerId === "") {
    return { vault, signIns };
  }
  for (const [address, connection] of Object.entries(vault?.spec?.connections ?? {})) {
    if (
      connection.source === VaultConnectionSource.sign_in &&
      connection.signIn?.mcpServerId === mcpServerId
    ) {
      signIns.push({ address, connection });
    }
  }
  return { vault, signIns };
}
