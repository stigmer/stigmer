/**
 * The one rule every server writer of a score follows when its create meets
 * a score from the same writer already on the run: `replaceUnlessGraded`.
 *
 * The server writes three states of one score, from lowest to highest:
 * pending (the judge picked the run), not graded (grading failed, with a
 * reason), graded. More than one writer can race for the same score: the
 * grading observer records "grading could not start" when its start passes
 * its deadline although the engine may have accepted the start, and the
 * judge's pending score is replaced by its grade or its not-graded reason.
 * So a create refused with ALREADY_EXISTS re-reads the run's score of the
 * same metric, source and version and replaces it only when it holds a
 * lower state than the one being written. A grade is never overwritten, a
 * placeholder never outlives a grade, and two writers of the same state
 * keep the first (stigmer#2057).
 *
 * The replacement is a delete then a create through the score's own chains
 * (ports.ts): score update admits a person's feedback only, which is what
 * keeps a check's or a judge's verdict final. A writer that loses the race
 * between the delete and its create re-reads and decides again, a bounded
 * number of times.
 *
 * Proven by temporal/grading/__tests__/judge-composed.test.ts (the
 * stigmer#2057 interleave among them) and activities.test.ts beside it.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import type { ScoreDeleter, ScoreRecorder } from "./ports.js";
import { listRunScores } from "./queries.js";

/** What a write did: recorded, kept the score already there, or found the run gone. */
export type ScoreWrite = "recorded" | "kept" | "run-gone";

export interface ScoreWriteDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly recorder: ScoreRecorder;
  readonly deleter: ScoreDeleter;
}

/** How many times a writer re-reads after losing a race before it gives up. */
const MAX_ATTEMPTS = 3;

/** Records `score`, replacing the same writer's score only when it holds a lower state. */
export async function replaceUnlessGraded(
  deps: ScoreWriteDeps,
  score: Score,
): Promise<ScoreWrite> {
  const incoming = rankOf(score);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await deps.recorder.record(score);
      return "recorded";
    } catch (error) {
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      if (error.code === Code.NotFound) {
        return "run-gone";
      }
      if (error.code !== Code.AlreadyExists) {
        throw error;
      }
    }
    const existing = await sameWriterScore(deps, score);
    if (existing === undefined) {
      continue;
    }
    if (rankOf(existing) >= incoming) {
      return "kept";
    }
    await deleteScore(deps.deleter, existing.metadata?.id ?? "");
  }
  deps.logger.warn("a score write kept losing its race; leaving the score there", {
    runId: score.spec?.runId ?? "",
    metric: score.spec?.metric ?? "",
  });
  return "kept";
}

/**
 * The run's score from the same writer as `score`: the same metric, a
 * server source, and the same evaluator version.
 */
export async function sameWriterScore(
  deps: Pick<ScoreWriteDeps, "store" | "logger">,
  score: Score,
): Promise<Score | undefined> {
  const spec = score.spec;
  if (spec === undefined) {
    return undefined;
  }
  const scores = await listRunScores(deps.store, deps.logger, spec.runId);
  return scores.find(
    (other) =>
      other.spec?.metric === spec.metric &&
      other.spec.source === spec.source &&
      other.spec.source !== ScoreSource.human &&
      other.spec.evaluatorVersion === spec.evaluatorVersion,
  );
}

/** Deletes one score through its delete chain; one already gone is fine. */
export async function deleteScore(
  deleter: ScoreDeleter,
  scoreId: string,
): Promise<void> {
  try {
    await deleter.delete(scoreId);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return;
    }
    throw error;
  }
}

/**
 * A score's rank: pending below not graded below graded. A request carries
 * its value or its requested state; a stored score carries its state.
 */
function rankOf(score: Score): number {
  if (score.spec?.value.case !== undefined) {
    return 2;
  }
  return score.status?.state === ScoreState.pending ? 0 : 1;
}
