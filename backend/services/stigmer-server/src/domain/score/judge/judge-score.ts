/**
 * The judge scores the server writes for a completed run: pending while
 * the judge works, then graded from its verdict, or not graded with a
 * reason. All three carry the rubrics' version (rubrics.ts), so the
 * one-per-version rule (CheckScoreUnique) holds across them, and are
 * recorded through the in-process create chain, where the source guard
 * admits a judge's source from the server alone.
 *
 * A score passes when no rubric failed: not applicable is not a failure.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreCriterionSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/spec_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { JUDGE_METRIC } from "../constants.js";
import { JUDGE_EVALUATOR_VERSION } from "./rubrics.js";
import type { RubricVerdict } from "./verdict.js";

/** The pending judge score of `run`: picked for grading, the grade not in yet. */
export function pendingJudgeScore(run: Run): Score {
  const score = baseScore(run);
  score.status = create(ScoreStatusSchema, { state: ScoreState.pending });
  return score;
}

/** The graded judge score of `run`, from the judge's verdict and the model it ran on. */
export function gradedJudgeScore(
  run: Run,
  verdicts: ReadonlyArray<RubricVerdict>,
  judgeModel: string,
): Score {
  const score = baseScore(run);
  if (score.spec !== undefined) {
    score.spec.value = {
      case: "passed",
      value: verdicts.every((verdict) => verdict.result !== CriterionResult.failed),
    };
    score.spec.criteria = verdicts.map((verdict) =>
      create(ScoreCriterionSchema, verdict),
    );
    score.spec.judgeModel = judgeModel;
  }
  return score;
}

/**
 * The not-graded judge score of `run`. The reason rides the request's
 * status, which the create chain keeps from the server alone.
 */
export function notGradedJudgeScore(run: Run, reason: string): Score {
  const score = baseScore(run);
  score.status = create(ScoreStatusSchema, { notGradedReason: reason });
  return score;
}

function baseScore(run: Run): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: create(ApiResourceMetadataSchema, {
      org: run.metadata?.org ?? "",
    }),
    spec: {
      runId: run.metadata?.id ?? "",
      metric: JUDGE_METRIC,
      source: ScoreSource.judge,
      evaluatorVersion: JUDGE_EVALUATOR_VERSION,
    },
  });
}
