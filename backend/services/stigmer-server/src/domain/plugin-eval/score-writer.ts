/**
 * The Score a plugin eval writes on each try's run: `source: eval`,
 * `metric: "eval"`, one criterion per grader, so the run's own page shows
 * why the try scored what it did, beside its run-health score.
 *
 *   - `evaluator_version` is the SHA-256 of the plugin archive's digest and
 *     the judge instruction's version: the suite's cases and graders live
 *     in the archive, and an AI-graded check's meaning moves with the
 *     instruction, so a score from one is never compared with another's as
 *     one. One eval score per run per version (the score chain's
 *     CheckScoreUnique), and a try's run belongs to one eval.
 *   - `passed` is every scored grader passed.
 *   - Each criterion is named after its grader (cut to the 63 characters a
 *     criterion name may hold, made unique within the score), its result
 *     the grader's verdict and its reason the grader's, cut to 500. An
 *     indicator, a grader the two-arm comparison does not score
 *     (scoring.ts), is `not_applicable`, its reason starting "indicator
 *     only" and keeping what it found.
 *   - A try the platform could not grade is a not-graded score with the
 *     reason, never a failing value.
 *
 * Written through `replaceUnlessGraded` (domain/score/record.ts), so a
 * retried activity that meets its earlier attempt's score keeps it, and a
 * grade replaces an earlier not-graded record.
 *
 * Proven by __tests__/score-writer.test.ts.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";

import type { EvalGrader } from "@stigmer/plugin-package";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreCriterionSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/spec_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { EVAL_METRIC } from "../score/constants.js";
import {
  JUDGE_INSTRUCTION_VERSION,
  REASON_MAX_LENGTH,
} from "../score/judge/rubrics.js";
import { replaceUnlessGraded } from "../score/record.js";
import type { ScoreWrite, ScoreWriteDeps } from "../score/record.js";
import type { GraderScoring } from "./scoring.js";
import { everyScoredPassed } from "./scoring.js";

/** The longest name a criterion holds (score/v1/spec.proto). */
export const CRITERION_NAME_MAX_LENGTH = 63;

/** The reason prefix of an indicator's criterion. */
export const INDICATOR_ONLY_REASON = "indicator only";

/** The version every eval score of the archive `digest` carries (the module header). */
export function evalEvaluatorVersion(digest: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({ suite: digest, instruction: JUDGE_INSTRUCTION_VERSION }),
    )
    .digest("hex");
}

/** One criterion name per grader: its own name, cut and made unique. */
export function criterionNames(graders: ReadonlyArray<EvalGrader>): string[] {
  const taken = new Set<string>();
  return graders.map((grader, index) => {
    const base = (
      grader.name.trim() === "" ? `grader-${index + 1}` : grader.name.trim()
    ).slice(0, CRITERION_NAME_MAX_LENGTH);
    let name = base;
    for (let suffix = 2; taken.has(name); suffix++) {
      const tail = `-${suffix}`;
      name = `${base.slice(0, CRITERION_NAME_MAX_LENGTH - tail.length)}${tail}`;
    }
    taken.add(name);
    return name;
  });
}

/** A graded try: each grader's verdict and how it counts. */
export interface GradedTry {
  readonly graders: ReadonlyArray<EvalGrader>;
  readonly scoring: ReadonlyArray<GraderScoring>;
  readonly verdicts: ReadonlyArray<{
    readonly passed: boolean;
    readonly reason: string;
  }>;
}

/** The graded eval score of `run` (the module header). */
export function gradedEvalScore(
  run: Run,
  digest: string,
  graded: GradedTry,
): Score {
  const score = baseScore(run, digest);
  const names = criterionNames(graded.graders);
  const passed = graded.verdicts.map((verdict) => verdict.passed);
  if (score.spec !== undefined) {
    score.spec.value = {
      case: "passed",
      value: everyScoredPassed(passed, graded.scoring),
    };
    score.spec.criteria = graded.graders.map((_, index) => {
      const verdict = graded.verdicts[index] ?? { passed: false, reason: "" };
      const scored = graded.scoring[index]?.scored ?? true;
      return create(ScoreCriterionSchema, {
        name: names[index] ?? `grader-${index + 1}`,
        result: !scored
          ? CriterionResult.not_applicable
          : verdict.passed
            ? CriterionResult.passed
            : CriterionResult.failed,
        reason: cut(
          scored
            ? verdict.reason
            : `${INDICATOR_ONLY_REASON}; ${verdict.passed ? "passed" : "failed"}: ${verdict.reason}`,
        ),
      });
    });
  }
  return score;
}

/** The not-graded eval score of `run`, with the reason the try was not graded. */
export function notGradedEvalScore(
  run: Run,
  digest: string,
  reason: string,
): Score {
  const score = baseScore(run, digest);
  score.status = create(ScoreStatusSchema, { notGradedReason: cut(reason) });
  return score;
}

/** Records an eval score under the server's write rule (the module header). */
export function writeEvalScore(
  deps: ScoreWriteDeps,
  score: Score,
): Promise<ScoreWrite> {
  return replaceUnlessGraded(deps, score);
}

function baseScore(run: Run, digest: string): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: create(ApiResourceMetadataSchema, {
      org: run.metadata?.org ?? "",
    }),
    spec: {
      runId: run.metadata?.id ?? "",
      metric: EVAL_METRIC,
      source: ScoreSource.eval,
      evaluatorVersion: evalEvaluatorVersion(digest),
    },
  });
}

function cut(text: string): string {
  return text.length <= REASON_MAX_LENGTH
    ? text
    : `${text.slice(0, REASON_MAX_LENGTH - 6)} [cut]`;
}
