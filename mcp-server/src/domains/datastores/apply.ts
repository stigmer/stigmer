// Datastore apply path: create-or-update via DatastoreCommandController.apply.
// The flat MCP input is projected into a fully-formed Datastore proto by the
// generated datastoreInputToProto bridge (codegen, src/gen/datastore.ts).
//
// The manifest is authoritative for structure, never for data: schema changes
// sync on apply (the server enforces its additive-plus change matrix), and
// records enter exclusively through the record tools.

import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { DatastoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/command_pb";

import { datastoreInputToProto, type DatastoreInput } from "../../gen/datastore.js";
import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Create or update a datastore, returning the persisted resource as protojson. */
export async function applyDatastore(
  serverAddress: string,
  token: string,
  input: DatastoreInput,
): Promise<string> {
  const datastore = datastoreInputToProto(input);
  const desc = `datastore "${datastore.metadata?.slug ?? ""}" in org "${datastore.metadata?.org ?? ""}"`;
  return withClient(DatastoreCommandController, serverAddress, token, async (client, callOptions) => {
    try {
      const result = await client.apply(datastore, callOptions);
      return toProtoJson(DatastoreSchema, result);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
