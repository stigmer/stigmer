// MCP tools for querying workflow execution status and event logs.
// Go parity: mcp-server/internal/domains/workflowexecutions/tools.go.
//
// Backed by WorkflowExecutionQueryController (get, getEventLog). These are
// diagnostic reads for running/failed executions.

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

/** Register the workflow-execution tools; returns the registered tool names. */
export function registerWorkflowExecutionTools(server: McpServer, target: BackendTarget): string[] {
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

  return ["get_workflow_execution", "get_workflow_execution_events"];
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
