// Workflow-execution approval paths: the org-wide pending-approvals inbox
// (listPendingApprovals) and the reviewer decision for a human_input task
// (submitWorkflowTaskApproval).
//
// listPendingApprovals is org-scoped by contract (io.proto), not
// execution-scoped — it answers "what is waiting on a human right now"
// across the org. Each entry carries everything a decision needs: the
// execution ID, task name, requester, timeout, and the form schema when the
// task defines one. Agent-execution approvals are a different surface
// entirely (embedded in get_agent_execution status; see
// agentexecutions/approve.ts).

import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import {
  type ListPendingApprovalsRequestSchema,
  PendingApprovalsListSchema,
  type SubmitWorkflowTaskApprovalInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

export interface ListPendingApprovalsArgs {
  readonly org: string;
  readonly pageSize?: number;
  readonly pageToken?: string;
}

/** List human_input tasks awaiting a reviewer decision across an org. */
export async function listPendingApprovals(
  serverAddress: string,
  token: string,
  args: ListPendingApprovalsArgs,
): Promise<string> {
  return withClient(
    WorkflowExecutionQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      const req: MessageInitShape<typeof ListPendingApprovalsRequestSchema> = {
        org: args.org,
        pageToken: args.pageToken ?? "",
      };
      // Forward page_size only when set, letting the server apply its default.
      if ((args.pageSize ?? 0) > 0) {
        req.pageSize = args.pageSize;
      }
      try {
        const resp = await client.listPendingApprovals(req, callOptions);
        return toProtoJson(PendingApprovalsListSchema, resp);
      } catch (err) {
        throw rpcError(err, `pending approvals in org "${args.org}"`);
      }
    },
  );
}

export interface SubmitWorkflowTaskApprovalArgs {
  readonly executionId: string;
  readonly taskName: string;
  readonly outcome: string;
  readonly comment?: string;
  readonly formData?: Record<string, unknown>;
}

/** Submit a reviewer decision for a waiting human_input task. */
export async function submitWorkflowTaskApproval(
  serverAddress: string,
  token: string,
  args: SubmitWorkflowTaskApprovalArgs,
): Promise<string> {
  return withClient(
    WorkflowExecutionCommandController,
    serverAddress,
    token,
    async (client, callOptions) => {
      const req: MessageInitShape<typeof SubmitWorkflowTaskApprovalInputSchema> = {
        executionId: args.executionId,
        taskName: args.taskName,
        outcome: args.outcome,
        comment: args.comment ?? "",
      };
      if (args.formData !== undefined) {
        // google.protobuf.Struct fields are plain JSON objects in protobuf-es v2.
        req.formData = args.formData as JsonObject;
      }
      try {
        const execution = await client.submitWorkflowTaskApproval(req, callOptions);
        return toProtoJson(WorkflowExecutionSchema, execution);
      } catch (err) {
        throw rpcError(
          err,
          `approval for task "${args.taskName}" in workflow execution "${args.executionId}"`,
        );
      }
    },
  );
}
