// Credential delete path: resolve org/slug → id via the Query controller,
// then delete via the Command controller, both over a single shared transport.
// Like McpServer, the command controller takes the generic
// ApiResourceDeleteInput{resource_id}.

import { createClient } from "@connectrpc/connect";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Delete a credential by org and slug, returning the deleted resource as protojson. */
export async function deleteCredential(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `credential "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(CredentialQueryController, transport);
    let id: string;
    try {
      const credential = await query.getByReference(
        { org, kind: ApiResourceKind.credential, slug },
        callOptions,
      );
      id = credential.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(CredentialCommandController, transport);
    try {
      const deleted = await command.delete({ resourceId: id }, callOptions);
      return toProtoJson(CredentialSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
