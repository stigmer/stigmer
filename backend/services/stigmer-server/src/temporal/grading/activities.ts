/**
 * The grading activities: load the completed run, run the checks, record
 * the run-health score through the score's create chain as the server
 * (domain/score/ports.ts), or record the run as not graded.
 *
 * Idempotent, as every activity must be: each write goes through the one
 * rule for the server's own scores (domain/score/record.ts,
 * replaceUnlessGraded), so a grade replaces a not-graded score from this
 * version of the checks and a not-graded record never replaces a grade.
 * The observer records "grading could not start" when its start passes its
 * deadline, and Temporal may have accepted that start all the same; the
 * rule keeps the grade whichever write lands first (stigmer#2057). A run
 * deleted before it was graded has nothing to score; one deleted while
 * its score was being written (after the run delete's cascade listed the
 * run's scores) has the score removed again when this activity reads the
 * run after recording. One order still leaves a score behind: the delete's
 * cascade lists before the write, this read finds the run still there, and
 * the run's row goes after it. Such a score is seen by nobody, since its
 * visibility is its run's, and goes with its organization's purge
 * (domain/score/cascade.ts says the same of a person's rating).
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { actionsOf } from "../../domain/score/checks/actions.js";
import { gradeRunHealth } from "../../domain/score/checks/checks.js";
import type { ScoreDeleter, ScoreRecorder } from "../../domain/score/ports.js";
import {
  deleteScore,
  replaceUnlessGraded,
  sameWriterScore,
} from "../../domain/score/record.js";
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
      const health = gradeRunHealth(actionsOf(run));
      return record(deps, runHealthScore(run, health));
    },
    [RECORD_NOT_GRADED_ACTIVITY_NAME]: async (runId, reason) => {
      const run = await loadRun(deps.store, runId);
      if (run === undefined) {
        return GRADE_RUN_GONE;
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

/**
 * Records a run-health score as the observer's fallback does
 * (domain/score/grading-observer.ts): a create that meets any score from
 * these checks keeps it, since a not-graded record never replaces anything
 * a writer of the same checks left (domain/score/record.ts). NOT_FOUND is
 * the run deleted meanwhile.
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
 * Records the run's score under the server's write rule, then reads the run
 * again: a run deleted after its delete's cascade listed its scores has the
 * score removed, so no score outlives its run.
 */
async function record(
  deps: GradingActivityDeps,
  score: Score,
): Promise<GradeOutcome> {
  const write = {
    store: deps.store,
    logger: deps.logger,
    recorder: deps.recorder(),
    deleter: deps.deleter(),
  };
  const result = await replaceUnlessGraded(write, score);
  if (result === "run-gone") {
    return GRADE_RUN_GONE;
  }
  if (result === "kept") {
    return GRADE_ALREADY_GRADED;
  }
  if ((await loadRun(deps.store, score.spec?.runId ?? "")) !== undefined) {
    return GRADE_RECORDED;
  }
  const written = await sameWriterScore(deps, score);
  if (written !== undefined) {
    await deleteScore(write.deleter, written.metadata?.id ?? "");
  }
  return GRADE_RUN_GONE;
}
