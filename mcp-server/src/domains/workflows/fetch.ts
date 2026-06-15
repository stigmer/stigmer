// Workflow read path: the single RPC both the get_workflow tool and the
// workflow resource template delegate to.
// Go parity: mcp-server/internal/domains/workflows/fetch.go.

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/**
 * Retrieve a workflow by org and slug, returning its protojson representation.
 * Errors are classified into user-facing messages via {@link rpcError}.
 */
export async function fetchWorkflow(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  return withClient(WorkflowQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const workflow = await client.getByReference(
        { org, kind: ApiResourceKind.workflow, slug },
        callOptions,
      );
      return toProtoJson(WorkflowSchema, workflow);
    } catch (err) {
      throw rpcError(err, `workflow "${slug}" in org "${org}"`);
    }
  });
}
