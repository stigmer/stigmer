// Run approval path: answer a tool use the run waits on, through the
// run's session (SessionCommandController.confirmToolUse and
// grantPermission).
//
// A call that needs a person's answer is a tool use of the session's event
// log; get_run lists the turn's waiting ones under `asks`, each by the
// `tool_use_id` an answer names. The answer is recorded on the session the
// run belongs to, read from the run first:
//   - allow and deny answer the one call (`user.tool_confirmation`); a deny
//     may carry a reason, which the agent reads and adapts to;
//   - allow_all allows the call and every call of its class (its built-in
//     category, MCP server or asking hook) for the rest of the turn
//     (`stigmer.permission.grant`), including the class's other waiting calls.
// The response is the recorded events as Managed Agents JSON; the turn
// itself is observed with get_run.

import { createClient } from "@connectrpc/connect";
import type { JsonObject } from "@bufbuild/protobuf";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { toManagedAgentsJson } from "@stigmer/client";

import { withTransport } from "../client.js";
import { rpcError } from "../rpcerr.js";
import { getRun, sessionIdOf } from "./fetch.js";

/** The answers a caller can give a waiting tool use. */
export const APPROVAL_DECISIONS = ["allow", "deny", "allow_all"] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export interface SubmitRunApprovalArgs {
  readonly runId: string;
  readonly toolUseId: string;
  readonly decision: ApprovalDecision;
  /** Why the call is denied, for the agent; only with deny. */
  readonly reason?: string;
}

/** Answer a waiting tool use; returns the recorded events as Managed Agents JSON. */
export async function submitRunApproval(
  serverAddress: string,
  token: string,
  args: SubmitRunApprovalArgs,
): Promise<string> {
  const reason = args.reason ?? "";
  if (reason !== "" && args.decision !== "deny") {
    throw new Error("reason is only accepted with deny: it is the message the agent reads when its call is refused");
  }
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const sessionId = sessionIdOf(await getRun(transport, callOptions, args.runId));
    const command = createClient(SessionCommandController, transport);
    try {
      if (args.decision === "allow_all") {
        const granted = await command.grantPermission({ sessionId, toolUseId: args.toolUseId }, callOptions);
        return render({
          decision: args.decision,
          tool_use_id: args.toolUseId,
          grant: granted.grant === undefined ? null : toManagedAgentsJson(granted.grant),
          confirmations: granted.confirmations.map(toManagedAgentsJson),
        });
      }
      const confirmation: SessionEvent = await command.confirmToolUse(
        { sessionId, toolUseId: args.toolUseId, result: args.decision, denyMessage: reason },
        callOptions,
      );
      return render({
        decision: args.decision,
        tool_use_id: args.toolUseId,
        confirmations: [toManagedAgentsJson(confirmation)],
      });
    } catch (err) {
      throw rpcError(err, `tool use "${args.toolUseId}" of run "${args.runId}"`);
    }
  });
}

function render(body: JsonObject): string {
  return JSON.stringify(body, null, 2);
}
