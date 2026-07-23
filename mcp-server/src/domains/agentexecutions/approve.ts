// Agent-execution approval path: submit a decision for a tool call the
// execution is waiting on (AgentExecutionCommandController.submitApproval).
//
// Pending approvals surface in get_agent_execution's
// status.pending_approvals[] — there is no org-wide inbox for agent
// executions (that exists only for workflow human_input tasks, see
// workflowexecutions/approvals.ts). The response reuses the compact
// projection: the returned AgentExecution embeds the full message history,
// which the approval loop doesn't need.

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";

import { withClient } from "../client.js";
import { rpcError } from "../rpcerr.js";
import { compactExecutionJson, DEFAULT_MESSAGE_LIMIT } from "./fetch.js";

/**
 * Model-facing action spelling → proto enum. APPROVE_ALL is deliberately not
 * exposed: blanket auto-approval is a run-configuration concern, not a
 * per-decision one.
 */
const APPROVAL_ACTIONS: Readonly<Record<string, ApprovalAction>> = {
  approve: ApprovalAction.APPROVE,
  skip: ApprovalAction.SKIP,
  reject: ApprovalAction.REJECT,
};

export interface SubmitAgentApprovalArgs {
  readonly executionId: string;
  readonly toolCallId: string;
  readonly action: string;
  readonly comment?: string;
}

/** Submit an approval decision; returns the execution in the compact view. */
export async function submitAgentApproval(
  serverAddress: string,
  token: string,
  args: SubmitAgentApprovalArgs,
): Promise<string> {
  const action = APPROVAL_ACTIONS[args.action];
  if (action === undefined) {
    throw new Error(`unknown action "${args.action}"; valid actions: approve, skip, reject`);
  }
  return withClient(
    AgentExecutionCommandController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const execution = await client.submitApproval(
          {
            agentExecutionId: args.executionId,
            toolCallId: args.toolCallId,
            action,
            comment: args.comment ?? "",
          },
          callOptions,
        );
        return compactExecutionJson(execution, DEFAULT_MESSAGE_LIMIT);
      } catch (err) {
        throw rpcError(err, `approval for agent execution "${args.executionId}"`);
      }
    },
  );
}
