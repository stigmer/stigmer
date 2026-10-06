// Workflow-run start path for the run_workflow tool.
//
// Mirrors the CLI's workflow run branch (client-apps/cli/src/commands/run.ts +
// resources/run/create.ts): resolve the org/slug reference to the workflow ID,
// then create the run. Asynchronous like run_agent — the tool returns the
// created run (wex_* ID) and observation happens through the existing
// get_workflow_run / get_workflow_run_events tools.

import { createClient } from "@connectrpc/connect";
import { create as createMessage } from "@bufbuild/protobuf";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/command_pb";
import { WorkflowRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { runName, toExecutionValues } from "../agentruns/run.js";
import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** apiVersion stamped on created runs; mirrors the CLI's run stack. */
const API_VERSION = "agentic.stigmer.ai/v1";

export interface RunWorkflowArgs {
  readonly org: string;
  readonly workflow: string;
  readonly message?: string;
  readonly runtimeEnv?: Record<string, string>;
}

/**
 * Start a workflow run: resolve org/slug → workflow ID, then create the run.
 * Returns the created run as protojson.
 */
export async function runWorkflow(
  serverAddress: string,
  token: string,
  args: RunWorkflowArgs,
): Promise<string> {
  const desc =
    args.org === ""
      ? `workflow "${args.workflow}"`
      : `workflow "${args.workflow}" in org "${args.org}"`;
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
    // injects STIGMER_ORG the same way, so a caller-supplied value wins. No
    // org named (a server that holds one fills it) injects nothing.
    const runtimeEnv = toExecutionValues(args.runtimeEnv);
    if (runtimeEnv.STIGMER_ORG === undefined && args.org !== "") {
      runtimeEnv.STIGMER_ORG = createMessage(ExecutionValueSchema, {
        value: args.org,
        isSecret: false,
      });
    }

    const run = createMessage(WorkflowRunSchema, {
      apiVersion: API_VERSION,
      kind: "WorkflowRun",
      metadata: createMessage(ApiResourceMetadataSchema, { name: runName(), org: args.org }),
      spec: createMessage(WorkflowRunSpecSchema, {
        workflowId,
        // Empty message means "just run" — the CLI applies the same default.
        triggerMessage: (args.message ?? "") === "" ? "execute" : args.message,
        runtimeEnv,
      }),
    });

    const command = createClient(WorkflowRunCommandController, transport);
    try {
      const created = await command.create(run, callOptions);
      return toProtoJson(WorkflowRunSchema, created);
    } catch (err) {
      throw rpcError(err, `run of ${desc}`);
    }
  });
}
