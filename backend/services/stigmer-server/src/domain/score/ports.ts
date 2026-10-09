/**
 * The server's own score writes, served by the in-process edge
 * (boot/inprocess.ts) as the `internal` caller: the grading code records a
 * run-health score and the run-delete cascade removes a run's scores, each
 * through the score's own chain, so every rule and cleanup step the chain
 * carries runs for the server's writes as for a person's.
 */
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";

/** The server's own create of one score, through its create chain. */
export interface ScoreRecorder {
  record(score: Score): Promise<Score>;
}

/** The server's own delete of one score, by id, through its delete chain. */
export interface ScoreDeleter {
  delete(scoreId: string): Promise<void>;
}
