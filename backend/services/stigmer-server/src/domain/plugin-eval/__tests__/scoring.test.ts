/**
 * Pins the eval's arithmetic (scoring.ts) against a hand-computed suite:
 * which graders score in two arms (`tool_used: Skill` and `arm: with-only`
 * are indicators; every grader excluded scores them all; `arm: both`
 * forces one; ablation none excludes nothing), a try's weighted score,
 * an arm's mean over its graded tries only, the delta, the threshold,
 * pass^k and perfect runs, and the suite's aggregates.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { EvalGrader, EvalGraderCheck } from "@stigmer/plugin-package";
import {
  PluginEvalArmSchema,
  PluginEvalCaseSchema,
  PluginEvalCaseTargetSchema,
  PluginEvalStatusSchema,
  PluginEvalTryState,
  PluginEvalTrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { PluginEvalTry } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";

import {
  everyScoredPassed,
  recomputeStatus,
  scoringOf,
  tryScore,
} from "../scoring.js";

const regex: EvalGraderCheck = {
  type: "regex",
  pattern: "x",
  flags: "",
  match: { kind: "contains" },
  target: { kind: "last_message" },
};
const skillFired: EvalGraderCheck = {
  type: "tool_used",
  tool: "Skill",
  min: 1,
};
const llm: EvalGraderCheck = {
  type: "llm",
  criteria: "c",
  focus: { kind: "last_message" },
};

function grader(
  check: EvalGraderCheck,
  weight = 1,
  arm?: EvalGrader["arm"],
): EvalGrader {
  return {
    name: check.type,
    path: "p",
    weight,
    check,
    ...(arm === undefined ? {} : { arm }),
  };
}

describe("which graders score", () => {
  it("makes tool_used Skill and arm with-only indicators in two arms", () => {
    const graders = [
      grader(regex, 2),
      grader(skillFired),
      grader(llm, 1, "with-only"),
    ];
    expect(scoringOf(graders, true).map((g) => g.scored)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("scores every grader when all would be excluded", () => {
    const graders = [grader(skillFired), grader(llm, 1, "with-only")];
    expect(scoringOf(graders, true).map((g) => g.scored)).toEqual([true, true]);
  });

  it("scores a grader marked arm both, and excludes nothing without a comparison", () => {
    const never: EvalGraderCheck = {
      type: "tool_used",
      tool: "Skill",
      min: 0,
      max: 0,
    };
    expect(
      scoringOf([grader(regex), grader(never, 1, "both")], true).map(
        (g) => g.scored,
      ),
    ).toEqual([true, true]);
    expect(
      scoringOf([grader(regex), grader(skillFired)], false).map(
        (g) => g.scored,
      ),
    ).toEqual([true, true]);
  });
});

describe("a try's score", () => {
  const scoring = scoringOf(
    [grader(regex, 2), grader(skillFired), grader(llm, 1)],
    true,
  );

  it("is the weighted share of the scored graders that passed", () => {
    expect(tryScore([true, false, false], scoring)).toBeCloseTo(2 / 3);
    expect(tryScore([false, true, true], scoring)).toBeCloseTo(1 / 3);
    expect(tryScore([true, false, true], scoring)).toBe(1);
  });

  it("passes when every scored grader passed, whatever the indicators say", () => {
    expect(everyScoredPassed([true, false, true], scoring)).toBe(true);
    expect(everyScoredPassed([true, true, false], scoring)).toBe(false);
  });
});

function tries(
  ...scores: Array<number | "not-graded" | "pending">
): PluginEvalTry[] {
  return scores.map((score, index) =>
    create(PluginEvalTrySchema, {
      index: index + 1,
      costUsd: 0.1,
      ...(score === "not-graded"
        ? {
            state: PluginEvalTryState.not_graded,
            notGradedReason: "platform busy",
          }
        : score === "pending"
          ? { state: PluginEvalTryState.pending }
          : { state: PluginEvalTryState.graded, score }),
    }),
  );
}

describe("the suite's summaries", () => {
  it("matches the hand-computed suite", () => {
    const status = create(PluginEvalStatusSchema, {
      cases: [
        create(PluginEvalCaseSchema, {
          caseName: "a",
          targets: [
            create(PluginEvalCaseTargetSchema, {
              withPlugin: create(PluginEvalArmSchema, {
                tries: tries(1, 2 / 3, "not-graded"),
              }),
              withoutPlugin: create(PluginEvalArmSchema, {
                tries: tries(1 / 3, 0, 2 / 3),
              }),
            }),
          ],
        }),
        create(PluginEvalCaseSchema, {
          caseName: "b",
          targets: [
            create(PluginEvalCaseTargetSchema, {
              withPlugin: create(PluginEvalArmSchema, {
                tries: tries(1, 1, 1),
              }),
              withoutPlugin: create(PluginEvalArmSchema, {
                tries: tries(0, 0, "pending"),
              }),
            }),
            create(PluginEvalCaseTargetSchema, {
              notRunReason: "not run: model 'x' is not in Stigmer's catalog",
            }),
          ],
        }),
        create(PluginEvalCaseSchema, {
          caseName: "c",
          notRunReason: "not run: env",
        }),
      ],
    });

    recomputeStatus(status, 0.8);

    const a = status.cases[0]?.targets[0];
    expect(a?.withPlugin?.score).toBeCloseTo(5 / 6);
    expect(a?.withPlugin?.gradedTries).toBe(2);
    expect(a?.withPlugin?.perfectRuns).toBe(1);
    expect(a?.withoutPlugin?.score).toBeCloseTo(1 / 3);
    expect(a?.delta).toBeCloseTo(0.5);
    expect(a?.passed).toBe(true);
    expect(a?.passK).toBe(false);

    const b = status.cases[1]?.targets[0];
    expect(b?.withPlugin?.score).toBe(1);
    expect(b?.withPlugin?.perfectRuns).toBe(3);
    expect(b?.withoutPlugin?.score).toBe(0);
    expect(b?.delta).toBe(1);
    expect(b?.passK).toBe(true);
    expect(status.cases[1]?.targets[1]?.passed).toBe(false);

    expect(status.aggregates?.overallScore).toBeCloseTo(11 / 12);
    expect(status.aggregates?.casesPassed).toBe(2);
    expect(status.aggregates?.casesTotal).toBe(2);
    expect(status.aggregates?.meanDelta).toBeCloseTo(0.75);
    expect(status.aggregates?.casesNotRun).toBe(1);
    expect(status.triesFinished).toBe(11);
    expect(status.costUsd).toBeCloseTo(1.2);
  });

  it("holds the threshold, and leaves the score and delta unset without graded tries", () => {
    const status = create(PluginEvalStatusSchema, {
      cases: [
        create(PluginEvalCaseSchema, {
          caseName: "a",
          targets: [
            create(PluginEvalCaseTargetSchema, {
              withPlugin: create(PluginEvalArmSchema, { tries: tries(0.5, 1) }),
            }),
            create(PluginEvalCaseTargetSchema, {
              withPlugin: create(PluginEvalArmSchema, {
                tries: tries("not-graded"),
              }),
              withoutPlugin: create(PluginEvalArmSchema, { tries: tries(1) }),
            }),
          ],
        }),
      ],
    });
    recomputeStatus(status, 1);
    expect(status.cases[0]?.targets[0]?.passed).toBe(false);
    expect(status.cases[0]?.targets[0]?.delta).toBeUndefined();
    expect(status.cases[0]?.targets[1]?.withPlugin?.score).toBeUndefined();
    expect(status.cases[0]?.targets[1]?.delta).toBeUndefined();
    expect(status.aggregates?.casesPassed).toBe(0);
    expect(status.aggregates?.meanDelta).toBeUndefined();
    expect(status.aggregates?.overallScore).toBeCloseTo(0.75);
  });
});
