// MCP tools for the WorkflowExecution domain: start a run (run_workflow),
// observe it (get_workflow_execution, get_workflow_execution_events — backed
// by WorkflowExecutionQueryController.get/getEventLog), and answer its
// human_input tasks (list_pending_approvals, submit_workflow_task_approval).
// The observation tools predate the rest and their names/descriptions are
// part of the original Go-parity contract
// (mcp-server/internal/domains/workflowexecutions/tools.go).

import type { MessageInitShape } from "@bufbuild/protobuf";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  type GetEventLogRequestSchema,
  GetEventLogResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { z } from "zod";

import { resolveToken, withClient, type BackendTarget } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";
import { textOrError } from "../toolresult.js";
import { listPendingApprovals, submitWorkflowTaskApproval } from "./approvals.js";
import { runWorkflow } from "./run.js";

/** Register the workflow-execution tools; returns the registered tool names. */
export function registerWorkflowExecutionTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "run_workflow",
    {
      description:
        "Start a workflow execution (asynchronous). Returns immediately with the created execution " +
        "(wex_* ID) while the run continues in the background — poll get_workflow_execution and " +
        "get_workflow_execution_events to observe progress and diagnose failures.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the workflow (e.g. stigmer)."),
        workflow: z
          .string()
          .describe("Workflow slug — the unique identifier within the org (e.g. release-notes)."),
        message: z
          .string()
          .optional()
          .describe("Trigger message passed to the workflow. Omit to run with the default trigger."),
        runtime_env: z
          .record(z.string())
          .optional()
          .describe(
            "Non-secret runtime environment values (name → value) injected into the run. " +
              "Secrets must come from Environments referenced by the workflow, never through this tool.",
          ),
      },
    },
    (args, extra) =>
      textOrError(() =>
        runWorkflow(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          workflow: args.workflow,
          message: args.message,
          runtimeEnv: args.runtime_env,
        }),
      ),
  );

  server.registerTool(
    "get_workflow_execution",
    {
      description:
        "Get a workflow execution's full status including phase, tasks, errors, cost, and timing. Use for diagnosing failed or running executions.",
      inputSchema: {
        execution_id: z.string().describe("Workflow execution ID (wex_* format)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        getWorkflowExecution(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.execution_id,
        ),
      ),
  );

  server.registerTool(
    "get_workflow_execution_events",
    {
      description:
        "Get the event log for a workflow execution. " +
        "Returns task transitions, errors, cost checkpoints, and approval events. " +
        "Use for deep diagnosis of execution failures.",
      inputSchema: {
        execution_id: z.string().describe("Workflow execution ID (wex_* format)."),
        task_name: z.string().optional().describe("Filter events by task name."),
        page_size: z
          .number()
          .int()
          .optional()
          .describe("Number of events per page (default 100, max 500)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        getWorkflowExecutionEvents(target.serverAddress, resolveToken(extra, target.apiKey), {
          executionId: args.execution_id,
          taskName: args.task_name,
          pageSize: args.page_size,
        }),
      ),
  );

  server.registerTool(
    "list_pending_approvals",
    {
      description:
        "List workflow tasks waiting for a human decision across an organization — an approvals " +
        "inbox. Each entry carries the execution ID, task name, requester, timeout, and the form " +
        "schema when the task defines one; respond with submit_workflow_task_approval. " +
        "(Agent-execution approvals are not listed here — they surface in get_agent_execution's " +
        "status.pending_approvals.)",
      inputSchema: {
        org: z.string().describe("Organization slug to scope the query (e.g. stigmer)."),
        page_size: z
          .number()
          .int()
          .optional()
          .describe("Maximum entries per page (default 20, max 100)."),
        page_token: z
          .string()
          .optional()
          .describe("Pagination token from a previous response's next_page_token."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        listPendingApprovals(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          pageSize: args.page_size,
          pageToken: args.page_token,
        }),
      ),
  );

  server.registerTool(
    "submit_workflow_task_approval",
    {
      description:
        "Submit a reviewer decision for a workflow human_input task that is waiting for a signal. " +
        "outcome must match one of the task's configured outcome names (default: approve or deny). " +
        "When the task defines a form_schema (see list_pending_approvals), provide matching " +
        "form_data. Returns the updated workflow execution.",
      inputSchema: {
        execution_id: z.string().describe("Workflow execution ID (wex_* format)."),
        task_name: z.string().describe("Name of the waiting human_input task."),
        outcome: z
          .string()
          .describe(
            "Decision outcome. Must match a configured outcome name of the task " +
              "(e.g. approve, deny, needs_revision); approve/deny when none are configured.",
          ),
        comment: z.string().optional().describe("Reviewer comment, stored in the audit trail."),
        form_data: z
          .record(z.unknown())
          .optional()
          .describe("Response form data conforming to the task's form_schema, when it defines one."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        submitWorkflowTaskApproval(target.serverAddress, resolveToken(extra, target.apiKey), {
          executionId: args.execution_id,
          taskName: args.task_name,
          outcome: args.outcome,
          comment: args.comment,
          formData: args.form_data,
        }),
      ),
  );

  return [
    "run_workflow",
    "get_workflow_execution",
    "get_workflow_execution_events",
    "list_pending_approvals",
    "submit_workflow_task_approval",
  ];
}

/** Fetch a single workflow execution by id. */
async function getWorkflowExecution(
  serverAddress: string,
  token: string,
  executionId: string,
): Promise<string> {
  if (executionId === "") {
    throw new Error("execution_id is required");
  }
  return withClient(
    WorkflowExecutionQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const execution = await client.get({ value: executionId }, callOptions);
        return toProtoJson(WorkflowExecutionSchema, execution);
      } catch (err) {
        throw rpcError(err, `workflow execution "${executionId}"`);
      }
    },
  );
}

interface EventLogArgs {
  readonly executionId: string;
  readonly taskName?: string;
  readonly pageSize?: number;
}

/** Fetch the event log for an execution, optionally filtered and paginated. */
async function getWorkflowExecutionEvents(
  serverAddress: string,
  token: string,
  args: EventLogArgs,
): Promise<string> {
  if (args.executionId === "") {
    throw new Error("execution_id is required");
  }
  return withClient(
    WorkflowExecutionQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      const req: MessageInitShape<typeof GetEventLogRequestSchema> = {
        executionId: args.executionId,
        taskName: args.taskName ?? "",
      };
      // Forward page_size only when set, letting the server apply its default.
      if ((args.pageSize ?? 0) > 0) {
        req.pageSize = args.pageSize;
      }
      try {
        const resp = await client.getEventLog(req, callOptions);
        return toProtoJson(GetEventLogResponseSchema, resp);
      } catch (err) {
        throw rpcError(err, `event log for execution "${args.executionId}"`);
      }
    },
  );
}
