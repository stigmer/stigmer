// Cross-kind run cancellation for the cancel_run tool.
//
// Runs are the one place the MCP surface routes on ID prefix rather than a
// kind argument: agent (aex_*) and workflow (wex_*) runs live on dedicated
// controllers but cancel with identical arguments, so one tool serves both —
// mirroring the CLI's run routing seam (`stigmer delete run`), including its
// cancel semantics: read the run first and short-circuit with "already
// terminal" instead of issuing a futile cancel, so the success/no-op
// distinction comes from authoritative state.

import { createClient } from "@connectrpc/connect";
import { type AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/command_pb";
import { RunPhase as AgentRunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";
import {
  WorkflowRunSchema,
  type WorkflowRun,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/command_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { WorkflowRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/query_pb";

import { compactRun, DEFAULT_MESSAGE_LIMIT } from "../agentruns/fetch.js";
import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

// Terminal phases per kind. The two RunPhase enums live in different
// proto packages with different numeric values (agent TERMINATED is 8,
// workflow TERMINATED is 6), so these are deliberately separate sets.
const TERMINAL_AGENT_PHASES: ReadonlySet<AgentRunPhase> = new Set([
  AgentRunPhase.RUN_COMPLETED,
  AgentRunPhase.RUN_FAILED,
  AgentRunPhase.RUN_CANCELLED,
  AgentRunPhase.RUN_TERMINATED,
]);

const TERMINAL_WORKFLOW_PHASES: ReadonlySet<WorkflowRunPhase> = new Set([
  WorkflowRunPhase.RUN_COMPLETED,
  WorkflowRunPhase.RUN_FAILED,
  WorkflowRunPhase.RUN_CANCELLED,
  WorkflowRunPhase.RUN_TERMINATED,
]);

/**
 * Resolve a run ID to its controller family by prefix. Matching is
 * case-sensitive and accepts both separators the backend does ("_" canonical,
 * "-" legacy), mirroring the CLI's run-type resolver.
 */
function resolveRunType(id: string): "agent" | "workflow" {
  const trimmed = id.trim();
  if (trimmed.startsWith("aex_") || trimmed.startsWith("aex-")) return "agent";
  if (trimmed.startsWith("wex_") || trimmed.startsWith("wex-")) return "workflow";
  throw new Error(
    `unrecognized run ID format: ${id}\n\n` +
      "Expected formats:\n" +
      "  Agent run:    aex_<26-char-ulid>\n" +
      "  Workflow run: wex_<26-char-ulid>",
  );
}

/**
 * Cancel a run of either kind. Returns a wrapper documenting whether a
 * cancel was actually issued: `{"already_terminal": bool, "run": …}`.
 * Agent runs are returned in the compact projection (their status embeds
 * the full message history); workflow runs as plain protojson, matching
 * get_workflow_run.
 */
export async function cancelRun(
  serverAddress: string,
  token: string,
  runId: string,
  reason: string,
): Promise<string> {
  return resolveRunType(runId) === "agent"
    ? cancelAgentRun(serverAddress, token, runId, reason)
    : cancelWorkflowRun(serverAddress, token, runId, reason);
}

async function cancelAgentRun(
  serverAddress: string,
  token: string,
  id: string,
  reason: string,
): Promise<string> {
  const desc = `agent run "${id}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    try {
      const query = createClient(AgentRunQueryController, transport);
      const current = await query.get({ value: id }, callOptions);
      const phase = current.status?.phase ?? AgentRunPhase.RUN_PHASE_UNSPECIFIED;
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

async function cancelWorkflowRun(
  serverAddress: string,
  token: string,
  id: string,
  reason: string,
): Promise<string> {
  const desc = `workflow run "${id}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    try {
      const query = createClient(WorkflowRunQueryController, transport);
      const current = await query.get({ value: id }, callOptions);
      const phase = current.status?.phase ?? WorkflowRunPhase.RUN_PHASE_UNSPECIFIED;
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

function wrapAgent(run: AgentRun, alreadyTerminal: boolean): string {
  const { totalMessages, data } = compactRun(run, DEFAULT_MESSAGE_LIMIT);
  return JSON.stringify(
    { already_terminal: alreadyTerminal, view: "compact", total_messages: totalMessages, run: data },
    null,
    2,
  );
}

function wrapWorkflow(run: WorkflowRun, alreadyTerminal: boolean): string {
  return JSON.stringify(
    {
      already_terminal: alreadyTerminal,
      run: JSON.parse(toProtoJson(WorkflowRunSchema, run)),
    },
    null,
    2,
  );
}
