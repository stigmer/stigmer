// Credential read path: the single RPC both the get_credential tool and the
// credential resource template delegate to.
//
// Secret handling happens entirely server-side: every Credential-returning
// RPC replaces each non-empty secret field value with the ***REDACTED***
// marker before it leaves the server, so this layer adds no redaction logic
// of its own — the server is the single enforcement point. revealField, the
// one RPC that returns a value, is deliberately not reachable from here.

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/**
 * Retrieve a credential by org and slug, returning its protojson
 * representation (secret values arrive already redacted by the server).
 */
export async function fetchCredential(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  return withClient(CredentialQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const credential = await client.getByReference(
        { org, kind: ApiResourceKind.credential, slug },
        callOptions,
      );
      return toProtoJson(CredentialSchema, credential);
    } catch (err) {
      throw rpcError(err, `credential "${slug}" in org "${org}"`);
    }
  });
}
