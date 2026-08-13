// Workflow apply path: create-or-update via the WorkflowCommandController.apply
// RPC. The flat MCP input is projected into a fully-formed Workflow proto by the
// generated workflowInputToProto bridge (codegen, src/gen/workflow.ts), which
// expands each task's typed config into the task_config Struct.
//
// Go parity note: the Go MCP server keeps apply_workflow registered but its
// generated input cannot express recursive task nesting in Go's jsonschema
// reflection. protobuf-es + zod's z.lazy resolve that limitation, so the TS
// server exposes apply_workflow at full fidelity.

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { workflowInputToProto, type WorkflowInput } from "../../gen/workflow.js";
import { applyDeclaredVisibility } from "../apply-visibility.js";
import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Create or update a workflow, returning the persisted workflow as protojson. */
export async function applyWorkflow(
  serverAddress: string,
  token: string,
  input: WorkflowInput,
): Promise<string> {
  const workflow = workflowInputToProto(input);
  const desc = `workflow "${workflow.metadata?.slug ?? ""}" in org "${workflow.metadata?.org ?? ""}"`;
  return withClient(
    WorkflowCommandController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const applied = await client.apply(workflow, callOptions);
        const result = await applyDeclaredVisibility(
          client,
          callOptions,
          applied,
          workflow.metadata?.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified,
        );
        return toProtoJson(WorkflowSchema, result);
      } catch (err) {
        throw rpcError(err, desc);
      }
    },
  );
}
