// Agent-run approval path: submit a decision for a tool call the run is
// waiting on (AgentRunCommandController.submitApproval).
//
// Pending approvals surface in get_run's status.pending_approvals[] —
// there is no org-wide inbox for agent runs. The response reuses the
// compact projection: the returned AgentRun embeds the full message history,
// which the approval loop doesn't need.

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";

import { withClient } from "../client.js";
import { rpcError } from "../rpcerr.js";
import { compactRunJson, DEFAULT_MESSAGE_LIMIT } from "./fetch.js";

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
  readonly runId: string;
  readonly toolCallId: string;
  readonly action: string;
  readonly comment?: string;
}

/** Submit an approval decision; returns the run in the compact view. */
export async function submitRunApproval(
  serverAddress: string,
  token: string,
  args: SubmitAgentApprovalArgs,
): Promise<string> {
  const action = APPROVAL_ACTIONS[args.action];
  if (action === undefined) {
    throw new Error(`unknown action "${args.action}"; valid actions: approve, skip, reject`);
  }
  return withClient(
    RunCommandController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const run = await client.submitApproval(
          {
            runId: args.runId,
            toolCallId: args.toolCallId,
            action,
            comment: args.comment ?? "",
          },
          callOptions,
        );
        return compactRunJson(run, DEFAULT_MESSAGE_LIMIT);
      } catch (err) {
        throw rpcError(err, `approval for agent run "${args.runId}"`);
      }
    },
  );
}
