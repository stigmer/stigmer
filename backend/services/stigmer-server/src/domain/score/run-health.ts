/**
 * The run-health score the server writes for a completed run: graded from
 * the checks (checks/), or not graded with a reason when grading could not
 * run. Both are built here so the grading activity and the observer's
 * fallback write one shape, recorded through the in-process create chain
 * (ports.ts), where the source guard admits a check from the server alone.
 *
 * A not-graded score carries the current checks' version, so the
 * one-per-version rule (CheckScoreUnique) holds for it too: a run is
 * graded once by a given version of the checks, whether or not the grade
 * could be produced.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreCriterionSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/spec_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { RUN_HEALTH_EVALUATOR_VERSION } from "./checks/checks.js";
import type { RunHealth } from "./checks/checks.js";
import { RUN_HEALTH_METRIC } from "./constants.js";

/** The graded run-health score of `run`. */
export function runHealthScore(run: Run, health: RunHealth): Score {
  const score = baseScore(run);
  if (score.spec !== undefined) {
    score.spec.value = { case: "passed", value: health.passed };
    score.spec.criteria = health.verdicts.map((verdict) =>
      create(ScoreCriterionSchema, verdict),
    );
  }
  return score;
}

/**
 * The not-graded run-health score of `run`. The reason rides the
 * request's status, which the create chain keeps from the server alone
 * (domain/score/steps.ts, ResolveScoreDefaults).
 */
export function notGradedRunHealthScore(run: Run, reason: string): Score {
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
      metric: RUN_HEALTH_METRIC,
      source: ScoreSource.check,
      evaluatorVersion: RUN_HEALTH_EVALUATOR_VERSION,
    },
  });
}
