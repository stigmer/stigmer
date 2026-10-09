/**
 * The grading activities: load the completed run, run the checks, record
 * the run-health score through the score's create chain as the server
 * (domain/score/ports.ts), or record the run as not graded.
 *
 * Idempotent, as every activity must be: a run that already carries a
 * graded run-health score from this version of the checks is left alone,
 * and the create chain's own one-per-version rule answers ALREADY_EXISTS
 * for a retry that lost the race, which counts as recorded. A not-graded
 * score from this version is replaced by the grade: the observer records
 * one when its start passes its deadline, and Temporal may have accepted
 * that start all the same. A run deleted before it was graded has nothing
 * to score; one deleted while its score was being written (after the run
 * delete's cascade listed the run's scores) has the score removed again
 * when this activity reads the run after recording. One order still leaves
 * a score behind: the delete's cascade lists before the write, this read
 * finds the run still there, and the run's row goes after it. Such a score
 * is seen by nobody, since its visibility is its run's, and goes with its
 * organization's purge (domain/score/cascade.ts says the same of a
 * person's rating).
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { actionsOf } from "../../domain/score/checks/actions.js";
import {
  RUN_HEALTH_EVALUATOR_VERSION,
  gradeRunHealth,
} from "../../domain/score/checks/checks.js";
import { RUN_HEALTH_METRIC } from "../../domain/score/constants.js";
import type { ScoreDeleter, ScoreRecorder } from "../../domain/score/ports.js";
import { listRunScores } from "../../domain/score/queries.js";
import {
  notGradedRunHealthScore,
  runHealthScore,
} from "../../domain/score/run-health.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_GONE,
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
} from "./names.js";
import type { GradeOutcome, GradingActivities } from "./names.js";

export interface GradingActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly recorder: () => ScoreRecorder;
  /** Resolved at call time, as the recorder. */
  readonly deleter: () => ScoreDeleter;
}

export function createGradingActivities(
  deps: GradingActivityDeps,
): GradingActivities {
  return {
    [GRADE_RUN_HEALTH_ACTIVITY_NAME]: async (runId) => {
      const run = await loadRun(deps.store, runId);
      if (run === undefined) {
        return GRADE_RUN_GONE;
      }
      const existing = await existingRunHealth(deps, runId);
      if (existing?.status?.state === ScoreState.graded) {
        return GRADE_ALREADY_GRADED;
      }
      if (existing !== undefined) {
        await deleteScore(deps, existing.metadata?.id ?? "");
      }
      const health = gradeRunHealth(actionsOf(run));
      return record(deps, runHealthScore(run, health));
    },
    [RECORD_NOT_GRADED_ACTIVITY_NAME]: async (runId, reason) => {
      const run = await loadRun(deps.store, runId);
      if (run === undefined) {
        return GRADE_RUN_GONE;
      }
      if ((await existingRunHealth(deps, runId)) !== undefined) {
        return GRADE_ALREADY_GRADED;
      }
      deps.logger.warn("run not graded", { runId, reason });
      return record(deps, notGradedRunHealthScore(run, reason));
    },
  };
}

async function loadRun(store: Store, runId: string): Promise<Run | undefined> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

/** The run's run-health score from this version of the checks, if any. */
async function existingRunHealth(
  deps: GradingActivityDeps,
  runId: string,
): Promise<Score | undefined> {
  const scores = await listRunScores(deps.store, deps.logger, runId);
  return scores.find(
    (score) =>
      score.spec?.metric === RUN_HEALTH_METRIC &&
      score.spec.source === ScoreSource.check &&
      score.spec.evaluatorVersion === RUN_HEALTH_EVALUATOR_VERSION,
  );
}

/** Deletes one score through its delete chain; one already gone is fine. */
async function deleteScore(
  deps: GradingActivityDeps,
  scoreId: string,
): Promise<void> {
  try {
    await deps.deleter().delete(scoreId);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return;
    }
    throw error;
  }
}

/**
 * Records a run-health score; shared with the observer's fallback
 * (domain/score/grading-observer.ts). ALREADY_EXISTS is a retry that lost
 * the race and counts as graded; NOT_FOUND is the run deleted meanwhile.
 */
export async function recordRunHealth(
  recorder: ScoreRecorder,
  score: Score,
): Promise<GradeOutcome> {
  try {
    await recorder.record(score);
    return GRADE_RECORDED;
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.AlreadyExists) {
        return GRADE_ALREADY_GRADED;
      }
      if (error.code === Code.NotFound) {
        return GRADE_RUN_GONE;
      }
    }
    throw error;
  }
}

/**
 * Records the run's score, then reads the run again: a run deleted after
 * its delete's cascade listed its scores has the score removed, so no
 * score outlives its run.
 */
async function record(
  deps: GradingActivityDeps,
  score: Score,
): Promise<GradeOutcome> {
  const runId = score.spec?.runId ?? "";
  const outcome = await recordRunHealth(deps.recorder(), score);
  if (outcome !== GRADE_RECORDED) {
    return outcome;
  }
  if ((await loadRun(deps.store, runId)) !== undefined) {
    return outcome;
  }
  const written = await existingRunHealth(deps, runId);
  if (written !== undefined) {
    await deleteScore(deps, written.metadata?.id ?? "");
  }
  return GRADE_RUN_GONE;
}
