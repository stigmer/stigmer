// Agent read path: the single RPC both the get_agent tool and the agent
// resource template delegate to. Mirrors Go internal/domains/agents/fetch.go.

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client";
import { toProtoJson } from "../marshal";
import { rpcError } from "../rpcerr";

/**
 * Retrieve an agent by org and slug, returning its protojson representation.
 * Errors are classified into user-facing messages via {@link rpcError}.
 */
export async function fetchAgent(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  return withClient(AgentQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const agent = await client.getByReference(
        { org, kind: ApiResourceKind.agent, slug },
        callOptions,
      );
      return toProtoJson(AgentSchema, agent);
    } catch (err) {
      throw rpcError(err, `agent "${slug}" in org "${org}"`);
    }
  });
}
