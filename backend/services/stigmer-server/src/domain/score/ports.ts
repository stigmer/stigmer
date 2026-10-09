/**
 * The server's own score writes, served by the in-process edge
 * (boot/inprocess.ts) as the `internal` caller: the grading code records a
 * run-health or judge score and the run-delete cascade removes a run's
 * scores, each through the score's own chain, so every rule and cleanup
 * step the chain carries runs for the server's writes as for a person's.
 *
 * The AI judge's run lane rides the same edge: the judge run is created
 * through the run's full create chain as the grading caller
 * (extensions/grading-caller.ts), and stopped and cleaned up as the server.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";

/** The server's own create of one score, through its create chain. */
export interface ScoreRecorder {
  record(score: Score): Promise<Score>;
}

/** The server's own delete of one score, by id, through its delete chain. */
export interface ScoreDeleter {
  delete(scoreId: string): Promise<void>;
}

/**
 * The judge run's create, through the run's full create chain (session
 * auto-create, launch gates, the hosted edition's billing reservation and
 * sandbox), as `caller` when the composition minted one, else as the server;
 * and its forceful stop when it outlives its budget.
 */
export interface JudgeRunCreator {
  create(run: Run, caller: CallerIdentity | undefined): Promise<Run>;
  terminate(runId: string, reason: string): Promise<void>;
}

/** The judge session's delete, through the session's delete chain, as the server. */
export interface JudgeSessionDeleter {
  delete(sessionId: string): Promise<void>;
}
