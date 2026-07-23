// Environment read path: the single RPC both the get_environment tool and the
// environment resource template delegate to.
//
// Secret handling happens entirely server-side: the response pipeline replaces
// every is_secret value with the ***REDACTED*** sentinel before it leaves the
// server (backend environment domain, preserve_redacted_secrets.go), so this
// layer adds no redaction logic of its own — the server is the single
// enforcement point.

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/**
 * Retrieve an environment by org and slug, returning its protojson
 * representation (secret values arrive already redacted by the server).
 */
export async function fetchEnvironment(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  return withClient(EnvironmentQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const environment = await client.getByReference(
        { org, kind: ApiResourceKind.environment, slug },
        callOptions,
      );
      return toProtoJson(EnvironmentSchema, environment);
    } catch (err) {
      throw rpcError(err, `environment "${slug}" in org "${org}"`);
    }
  });
}
