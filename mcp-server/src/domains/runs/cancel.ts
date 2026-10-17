// Run cancellation for the cancel_run tool: interrupt the run's session
// (SessionCommandController.interrupt).
//
// An interrupt stops every unfinished turn of the conversation (queued,
// working, waiting for an answer or paused), not one run alone: each ends
// cancelled. The tool reads the run first and short-circuits with "already
// terminal" when the run has ended, so a cancel aimed at a finished run
// never stops a later turn of the same conversation, and the success/no-op
// distinction comes from authoritative state. The response names the runs
// the interrupt stopped.

import { createClient } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";

import { withTransport } from "../client.js";
import { rpcError } from "../rpcerr.js";
import { getRun, runLifecycle, sessionIdOf } from "./fetch.js";

const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/**
 * Cancel a run by interrupting its session. Returns a wrapper documenting
 * whether an interrupt was issued: `{"already_terminal": true, "run": …}`
 * with the ended run's lifecycle, or `{"already_terminal": false,
 * "session_id": …, "stopped_run_ids": […]}`.
 */
export async function cancelRun(serverAddress: string, token: string, id: string): Promise<string> {
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const run = await getRun(transport, callOptions, id);
    const sessionId = sessionIdOf(run);
    if (TERMINAL_PHASES.has(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
      return JSON.stringify({ already_terminal: true, run: runLifecycle(run) }, null, 2);
    }
    try {
      const interrupted = await createClient(SessionCommandController, transport).interrupt({ sessionId }, callOptions);
      return JSON.stringify(
        { already_terminal: false, session_id: sessionId, stopped_run_ids: interrupted.stoppedRunIds },
        null,
        2,
      );
    } catch (err) {
      throw rpcError(err, `session "${sessionId}" of run "${id}"`);
    }
  });
}
