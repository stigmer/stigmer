// Workflow delete path: resolve org/slug → id, then delete, both over a single
// shared transport.
// Go parity: mcp-server/internal/domains/workflows/delete.go.

import { createClient } from "@connectrpc/connect";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Delete a workflow by org and slug, returning the deleted workflow as protojson. */
export async function deleteWorkflow(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `workflow "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(WorkflowQueryController, transport);
    let id: string;
    try {
      const workflow = await query.getByReference(
        { org, kind: ApiResourceKind.workflow, slug },
        callOptions,
      );
      id = workflow.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(WorkflowCommandController, transport);
    try {
      const deleted = await command.delete({ value: id }, callOptions);
      return toProtoJson(WorkflowSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
