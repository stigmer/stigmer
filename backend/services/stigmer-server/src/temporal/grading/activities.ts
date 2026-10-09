/**
 * The grading activities: load the completed run, run the checks, record
 * the run-health score through the score's create chain as the server
 * (domain/score/ports.ts), or record the run as not graded.
 *
 * Idempotent, as every activity must be: a run that already carries a
 * run-health score from this version of the checks is left alone, and the
 * create chain's own one-per-version rule answers ALREADY_EXISTS for a
 * retry that lost the race, which counts as recorded. A run deleted before
 * it was graded has nothing to score.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { actionsOf } from "../../domain/score/checks/actions.js";
import {
  RUN_HEALTH_EVALUATOR_VERSION,
  gradeRunHealth,
} from "../../domain/score/checks/checks.js";
import { RUN_HEALTH_SCORE_NAME } from "../../domain/score/constants.js";
import type { ScoreRecorder } from "../../domain/score/ports.js";
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
      if (await alreadyGraded(deps.store, runId)) {
        return GRADE_ALREADY_GRADED;
      }
      const health = gradeRunHealth(actionsOf(run));
      return record(deps, runHealthScore(run, health));
    },
    [RECORD_NOT_GRADED_ACTIVITY_NAME]: async (runId, reason) => {
      const run = await loadRun(deps.store, runId);
      if (run === undefined) {
        return GRADE_RUN_GONE;
      }
      if (await alreadyGraded(deps.store, runId)) {
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

/** Whether the run carries a run-health score from this version of the checks. */
async function alreadyGraded(store: Store, runId: string): Promise<boolean> {
  const scores = await listRunScores(store, runId);
  return scores.some(
    (score) =>
      score.spec?.name === RUN_HEALTH_SCORE_NAME &&
      score.spec.source === ScoreSource.check &&
      score.spec.evaluatorVersion === RUN_HEALTH_EVALUATOR_VERSION,
  );
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

function record(
  deps: GradingActivityDeps,
  score: Score,
): Promise<GradeOutcome> {
  return recordRunHealth(deps.recorder(), score);
}
