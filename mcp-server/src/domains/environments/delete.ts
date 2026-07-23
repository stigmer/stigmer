// Environment delete path: resolve org/slug → id via the Query controller,
// then delete via the Command controller, both over a single shared transport.
// Like McpServer, the command controller takes the generic
// ApiResourceDeleteInput{resource_id}.

import { createClient } from "@connectrpc/connect";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Delete an environment by org and slug, returning the deleted resource as protojson. */
export async function deleteEnvironment(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `environment "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(EnvironmentQueryController, transport);
    let id: string;
    try {
      const environment = await query.getByReference(
        { org, kind: ApiResourceKind.environment, slug },
        callOptions,
      );
      id = environment.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(EnvironmentCommandController, transport);
    try {
      const deleted = await command.delete({ resourceId: id }, callOptions);
      return toProtoJson(EnvironmentSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
