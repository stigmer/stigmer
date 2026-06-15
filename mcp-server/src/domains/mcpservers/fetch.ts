// MCP server read path: the single RPC both the get_mcp_server tool and the
// mcp-server resource template delegate to.
// Go parity: mcp-server/internal/domains/mcpservers/fetch.go.

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/**
 * Retrieve an MCP server by org and slug, returning its protojson
 * representation. Errors are classified into user-facing messages via
 * {@link rpcError}.
 */
export async function fetchMcpServer(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  return withClient(McpServerQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const mcpServer = await client.getByReference(
        { org, kind: ApiResourceKind.mcp_server, slug },
        callOptions,
      );
      return toProtoJson(McpServerSchema, mcpServer);
    } catch (err) {
      throw rpcError(err, `MCP server "${slug}" in org "${org}"`);
    }
  });
}
