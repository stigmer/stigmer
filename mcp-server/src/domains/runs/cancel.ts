// Run cancellation for the cancel_run tool.
//
// Mirrors the CLI's cancel semantics: read the run first and short-circuit
// with "already terminal" instead of issuing a futile cancel, so the
// success/no-op distinction comes from authoritative state.

import { createClient } from "@connectrpc/connect";
import { type AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";

import { compactRun, DEFAULT_MESSAGE_LIMIT } from "../agentruns/fetch.js";
import { withTransport } from "../client.js";
import { rpcError } from "../rpcerr.js";

const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/**
 * Cancel an agent run. Returns a wrapper documenting whether a cancel was
 * actually issued: `{"already_terminal": bool, "run": …}`, the run in the
 * compact projection (its status embeds the full message history).
 */
export async function cancelRun(
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
      const phase = current.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
      if (TERMINAL_PHASES.has(phase)) {
        return wrap(current, true);
      }
      const command = createClient(AgentRunCommandController, transport);
      const cancelled = await command.cancel({ id, reason }, callOptions);
      return wrap(cancelled, false);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}

function wrap(run: AgentRun, alreadyTerminal: boolean): string {
  const { totalMessages, data } = compactRun(run, DEFAULT_MESSAGE_LIMIT);
  return JSON.stringify(
    { already_terminal: alreadyTerminal, view: "compact", total_messages: totalMessages, run: data },
    null,
    2,
  );
}
