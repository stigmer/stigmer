// Cross-kind execution cancellation for the cancel_execution tool.
//
// Executions are the one place the MCP surface routes on ID prefix rather
// than a kind argument: agent (aex_*) and workflow (wex_*) executions live on
// dedicated controllers but cancel with identical arguments, so one tool
// serves both — mirroring the CLI's routing seam
// (client-apps/cli/src/resources/execution.ts), including its cancel
// semantics: read the execution first and short-circuit with
// "already terminal" instead of issuing a futile cancel, so the
// success/no-op distinction comes from authoritative state.

import { createClient } from "@connectrpc/connect";
import { type AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/command_pb";
import { RunPhase as AgentExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";
import {
  WorkflowRunSchema,
  type WorkflowRun,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/command_pb";
import { RunPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { WorkflowRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/query_pb";

import { compactExecution, DEFAULT_MESSAGE_LIMIT } from "../agentexecutions/fetch.js";
import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

// Terminal phases per kind. The two ExecutionPhase enums live in different
// proto packages with different numeric values (agent TERMINATED is 8,
// workflow TERMINATED is 6), so these are deliberately separate sets.
const TERMINAL_AGENT_PHASES: ReadonlySet<AgentExecutionPhase> = new Set([
  AgentExecutionPhase.RUN_COMPLETED,
  AgentExecutionPhase.RUN_FAILED,
  AgentExecutionPhase.RUN_CANCELLED,
  AgentExecutionPhase.RUN_TERMINATED,
]);

const TERMINAL_WORKFLOW_PHASES: ReadonlySet<WorkflowExecutionPhase> = new Set([
  WorkflowExecutionPhase.RUN_COMPLETED,
  WorkflowExecutionPhase.RUN_FAILED,
  WorkflowExecutionPhase.RUN_CANCELLED,
  WorkflowExecutionPhase.RUN_TERMINATED,
]);

/**
 * Resolve an execution ID to its controller family by prefix. Matching is
 * case-sensitive and accepts both separators the backend does ("_" canonical,
 * "-" legacy), mirroring the CLI's resolveExecutionType.
 */
function resolveExecutionType(id: string): "agent" | "workflow" {
  const trimmed = id.trim();
  if (trimmed.startsWith("aex_") || trimmed.startsWith("aex-")) return "agent";
  if (trimmed.startsWith("wex_") || trimmed.startsWith("wex-")) return "workflow";
  throw new Error(
    `unrecognized execution ID format: ${id}\n\n` +
      "Expected formats:\n" +
      "  Agent execution:    aex_<26-char-ulid>\n" +
      "  Workflow execution: wex_<26-char-ulid>",
  );
}

/**
 * Cancel an execution of either kind. Returns a wrapper documenting whether a
 * cancel was actually issued: `{"already_terminal": bool, "execution": …}`.
 * Agent executions are returned in the compact projection (their status embeds
 * the full message history); workflow executions as plain protojson, matching
 * get_workflow_execution.
 */
export async function cancelExecution(
  serverAddress: string,
  token: string,
  executionId: string,
  reason: string,
): Promise<string> {
  return resolveExecutionType(executionId) === "agent"
    ? cancelAgentExecution(serverAddress, token, executionId, reason)
    : cancelWorkflowExecution(serverAddress, token, executionId, reason);
}

async function cancelAgentExecution(
  serverAddress: string,
  token: string,
  id: string,
  reason: string,
): Promise<string> {
  const desc = `agent execution "${id}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    try {
      const query = createClient(AgentRunQueryController, transport);
      const current = await query.get({ value: id }, callOptions);
      const phase = current.status?.phase ?? AgentExecutionPhase.RUN_PHASE_UNSPECIFIED;
      if (TERMINAL_AGENT_PHASES.has(phase)) {
        return wrapAgent(current, true);
      }
      const command = createClient(AgentRunCommandController, transport);
      const cancelled = await command.cancel({ id, reason }, callOptions);
      return wrapAgent(cancelled, false);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}

async function cancelWorkflowExecution(
  serverAddress: string,
  token: string,
  id: string,
  reason: string,
): Promise<string> {
  const desc = `workflow execution "${id}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    try {
      const query = createClient(WorkflowRunQueryController, transport);
      const current = await query.get({ value: id }, callOptions);
      const phase = current.status?.phase ?? WorkflowExecutionPhase.RUN_PHASE_UNSPECIFIED;
      if (TERMINAL_WORKFLOW_PHASES.has(phase)) {
        return wrapWorkflow(current, true);
      }
      const command = createClient(WorkflowRunCommandController, transport);
      const cancelled = await command.cancel({ id, reason }, callOptions);
      return wrapWorkflow(cancelled, false);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}

function wrapAgent(execution: AgentRun, alreadyTerminal: boolean): string {
  const { totalMessages, data } = compactExecution(execution, DEFAULT_MESSAGE_LIMIT);
  return JSON.stringify(
    { already_terminal: alreadyTerminal, view: "compact", total_messages: totalMessages, execution: data },
    null,
    2,
  );
}

function wrapWorkflow(execution: WorkflowRun, alreadyTerminal: boolean): string {
  return JSON.stringify(
    {
      already_terminal: alreadyTerminal,
      execution: JSON.parse(toProtoJson(WorkflowRunSchema, execution)),
    },
    null,
    2,
  );
}
