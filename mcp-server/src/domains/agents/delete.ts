// Agent delete path: resolve org/slug → id via the Query controller, then
// delete via the Command controller, both over a single shared transport.
// Go parity: mcp-server/internal/domains/agents/delete.go.

import { createClient } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Delete an agent by org and slug, returning the deleted agent as protojson. */
export async function deleteAgent(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `agent "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(AgentQueryController, transport);
    let id: string;
    try {
      const agent = await query.getByReference({ org, kind: ApiResourceKind.agent, slug }, callOptions);
      id = agent.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(AgentCommandController, transport);
    try {
      const deleted = await command.delete({ value: id }, callOptions);
      return toProtoJson(AgentSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
