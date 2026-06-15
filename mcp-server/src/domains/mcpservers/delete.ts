// MCP server delete path: resolve org/slug → id, then delete, both over a single
// shared transport.
// Go parity: mcp-server/internal/domains/mcpservers/delete.go.
//
// Outlier: unlike the agent/skill/workflow command controllers (which take a
// typed {X}Id), McpServerCommandController.delete takes the generic
// ApiResourceDeleteInput{resource_id}.

import { createClient } from "@connectrpc/connect";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/**
 * Delete an MCP server by org and slug, returning the deleted MCP server as
 * protojson.
 */
export async function deleteMcpServer(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `MCP server "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(McpServerQueryController, transport);
    let id: string;
    try {
      const mcpServer = await query.getByReference(
        { org, kind: ApiResourceKind.mcp_server, slug },
        callOptions,
      );
      id = mcpServer.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(McpServerCommandController, transport);
    try {
      const deleted = await command.delete({ resourceId: id }, callOptions);
      return toProtoJson(McpServerSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
