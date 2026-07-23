// Workflow-execution start path for the run_workflow tool.
//
// Mirrors the CLI's workflow run branch (client-apps/cli/src/commands/run.ts +
// resources/run/create.ts): resolve the org/slug reference to the workflow ID,
// then create the execution. Asynchronous like run_agent — the tool returns
// the created execution (wex_* ID) and observation happens through the
// existing get_workflow_execution / get_workflow_execution_events tools.

import { createClient } from "@connectrpc/connect";
import { create as createMessage } from "@bufbuild/protobuf";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { WorkflowExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { executionName, toExecutionValues } from "../agentexecutions/run.js";
import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** apiVersion stamped on created executions; mirrors the CLI's run stack. */
const API_VERSION = "agentic.stigmer.ai/v1";

export interface RunWorkflowArgs {
  readonly org: string;
  readonly workflow: string;
  readonly message?: string;
  readonly runtimeEnv?: Record<string, string>;
}

/**
 * Start a workflow execution: resolve org/slug → workflow ID, then create the
 * execution. Returns the created execution as protojson.
 */
export async function runWorkflow(
  serverAddress: string,
  token: string,
  args: RunWorkflowArgs,
): Promise<string> {
  const desc = `workflow "${args.workflow}" in org "${args.org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(WorkflowQueryController, transport);
    let workflowId: string;
    try {
      const workflow = await query.getByReference(
        { org: args.org, kind: ApiResourceKind.workflow, slug: args.workflow },
        callOptions,
      );
      workflowId = workflow.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    // Workflow tasks resolve their org through the runtime env; the CLI
    // injects STIGMER_ORG_ID the same way, so a caller-supplied value wins.
    const runtimeEnv = toExecutionValues(args.runtimeEnv);
    if (runtimeEnv.STIGMER_ORG_ID === undefined) {
      runtimeEnv.STIGMER_ORG_ID = createMessage(ExecutionValueSchema, {
        value: args.org,
        isSecret: false,
      });
    }

    const execution = createMessage(WorkflowExecutionSchema, {
      apiVersion: API_VERSION,
      kind: "WorkflowExecution",
      metadata: createMessage(ApiResourceMetadataSchema, { name: executionName(), org: args.org }),
      spec: createMessage(WorkflowExecutionSpecSchema, {
        workflowId,
        // Empty message means "just run" — the CLI applies the same default.
        triggerMessage: (args.message ?? "") === "" ? "execute" : args.message,
        runtimeEnv,
      }),
    });

    const command = createClient(WorkflowExecutionCommandController, transport);
    try {
      const created = await command.create(execution, callOptions);
      return toProtoJson(WorkflowExecutionSchema, created);
    } catch (err) {
      throw rpcError(err, `execution of ${desc}`);
    }
  });
}
