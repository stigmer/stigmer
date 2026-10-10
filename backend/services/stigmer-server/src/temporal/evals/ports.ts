/**
 * What the eval's activities ask of the rest of the server, served by the
 * in-process edge (boot/inprocess.ts): a try's or a vote's session and
 * run, created through their full create chains as the eval's caller
 * (extensions/plugin-eval-caller.ts) when one was minted, else as the
 * server; and their stop and cleanup as the server. The session is
 * created first and on its own so it may carry the reserved
 * `stigmer.ai/plugin-eval` label: an in-process, server-composed request
 * may stamp it (pipeline/steps/guard-reserved-labels.ts), a session born
 * inline from a run's create carries none of the run's labels.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";

export interface PluginEvalTryLane {
  createSession(session: Session, caller: CallerIdentity | undefined): Promise<Session>;
  createRun(run: Run, caller: CallerIdentity | undefined): Promise<Run>;
  terminateRun(runId: string, reason: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
