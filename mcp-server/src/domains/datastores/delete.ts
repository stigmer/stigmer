// Datastore delete path: resolve org/slug → id via the Query controller, then
// delete via the Command controller, both over a single shared transport. Like
// McpServer, the command controller takes ApiResourceDeleteInput{resource_id}.
//
// This is the only path that destroys collections — record tools can delete
// individual records but never structure.

import { createClient } from "@connectrpc/connect";
import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { DatastoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/command_pb";
import { DatastoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Delete a datastore by org and slug, returning the deleted resource as protojson. */
export async function deleteDatastore(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `datastore "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(DatastoreQueryController, transport);
    let id: string;
    try {
      const datastore = await query.getByReference(
        { org, kind: ApiResourceKind.datastore, slug },
        callOptions,
      );
      id = datastore.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(DatastoreCommandController, transport);
    try {
      const deleted = await command.delete({ resourceId: id }, callOptions);
      return toProtoJson(DatastoreSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
