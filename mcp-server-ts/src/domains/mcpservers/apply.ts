// McpServer apply path: create-or-update via the McpServerCommandController.apply
// RPC. The flat MCP input is projected into a fully-formed McpServer proto by the
// generated mcpServerInputToProto bridge (codegen, src/gen/mcpserver.ts), which
// also rebuilds the stdio/http oneof, before the call.
// Go parity: mcp-server/internal/domains/mcpservers/apply.go.

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";

import { mcpServerInputToProto, type McpServerInput } from "../../gen/mcpserver";
import { withClient } from "../client";
import { toProtoJson } from "../marshal";
import { rpcError } from "../rpcerr";

/** Create or update an MCP server, returning the persisted server as protojson. */
export async function applyMcpServer(
  serverAddress: string,
  token: string,
  input: McpServerInput,
): Promise<string> {
  const server = mcpServerInputToProto(input);
  const desc = `mcp server "${server.metadata?.slug ?? ""}" in org "${server.metadata?.org ?? ""}"`;
  return withClient(
    McpServerCommandController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const result = await client.apply(server, callOptions);
        return toProtoJson(McpServerSchema, result);
      } catch (err) {
        throw rpcError(err, desc);
      }
    },
  );
}
