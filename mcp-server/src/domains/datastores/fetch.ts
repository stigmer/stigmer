// Datastore-definition read path: the single RPC both the get_datastore tool
// and the datastore resource template delegate to. This is the *structure*
// surface (collections, constraints, grants); living records are served by the
// record tools (records/), whose agent-facing summary is describe_datastore.

import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { DatastoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Retrieve a datastore by org and slug, returning its protojson representation. */
export async function fetchDatastore(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  return withClient(DatastoreQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const datastore = await client.getByReference(
        { org, kind: ApiResourceKind.datastore, slug },
        callOptions,
      );
      return toProtoJson(DatastoreSchema, datastore);
    } catch (err) {
      throw rpcError(err, `datastore "${slug}" in org "${org}"`);
    }
  });
}
