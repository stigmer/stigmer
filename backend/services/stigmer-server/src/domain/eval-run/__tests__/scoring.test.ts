/**
 * Pins the eval's arithmetic (scoring.ts) against a hand-computed suite:
 * which graders score in two arms (`tool_used: Skill`, a grader over
 * `mock_calls` and `arm: with-only` are indicators; every grader excluded scores them all; `arm: both`
 * forces one; ablation none excludes nothing), a try's weighted score,
 * an arm's mean over its graded tries only, the delta, the threshold,
 * pass^k and perfect runs, and the suite's aggregates, which count only
 * the cases and targets at least one of whose with-plugin tries was
 * graded.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { EvalGrader, EvalGraderCheck } from "@stigmer/plugin-package";
import {
  EvalRunArmSchema,
  EvalRunCaseSchema,
  EvalRunCaseTargetSchema,
  EvalRunPluginSchema,
  EvalRunStatusSchema,
  EvalRunTryState,
  EvalRunTrySchema,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { EvalRunTry } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";

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

  it("makes a regex or llm grader over the mock calls an indicator in two arms", () => {
    const graders = [
      grader(regex),
      grader({ ...regex, target: { kind: "mock_calls" } }),
      grader({ ...llm, focus: { kind: "mock_calls" } }),
      grader({ ...regex, target: { kind: "mock_calls" } }, 1, "both"),
    ];
    expect(scoringOf(graders, true).map((g) => g.scored)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(scoringOf(graders, false).every((g) => g.scored)).toBe(true);
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
): EvalRunTry[] {
  return scores.map((score, index) =>
    create(EvalRunTrySchema, {
      index: index + 1,
      costUsd: 0.1,
      ...(score === "not-graded"
        ? {
            state: EvalRunTryState.not_graded,
            notGradedReason: "platform busy",
          }
        : score === "pending"
          ? { state: EvalRunTryState.pending }
          : { state: EvalRunTryState.graded, score }),
    }),
  );
}

describe("the suite's summaries", () => {
  it("matches the hand-computed suite", () => {
    const status = create(EvalRunStatusSchema, {
      plugins: [
        create(EvalRunPluginSchema, {
          cases: [
            create(EvalRunCaseSchema, {
              caseName: "a",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries(1, 2 / 3, "not-graded"),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, {
                    tries: tries(1 / 3, 0, 2 / 3),
                  }),
                }),
              ],
            }),
            create(EvalRunCaseSchema, {
              caseName: "b",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries(1, 1, 1),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, {
                    tries: tries(0, 0, "pending"),
                  }),
                }),
                create(EvalRunCaseTargetSchema, {
                  notRunReason:
                    "not run: model 'x' is not in Stigmer's catalog",
                }),
              ],
            }),
            create(EvalRunCaseSchema, {
              caseName: "c",
              notRunReason: "not run: env",
            }),
          ],
        }),
      ],
    });

    recomputeStatus(status, 0.8);

    const a = status.plugins[0]!.cases[0]?.targets[0];
    expect(a?.withPlugin?.score).toBeCloseTo(5 / 6);
    expect(a?.withPlugin?.gradedTries).toBe(2);
    expect(a?.withPlugin?.perfectRuns).toBe(1);
    expect(a?.withoutPlugin?.score).toBeCloseTo(1 / 3);
    expect(a?.delta).toBeCloseTo(0.5);
    expect(a?.passed).toBe(true);
    expect(a?.passK).toBe(false);

    const b = status.plugins[0]!.cases[1]?.targets[0];
    expect(b?.withPlugin?.score).toBe(1);
    expect(b?.withPlugin?.perfectRuns).toBe(3);
    expect(b?.withoutPlugin?.score).toBe(0);
    expect(b?.delta).toBe(1);
    expect(b?.passK).toBe(true);
    expect(status.plugins[0]!.cases[1]?.targets[1]?.passed).toBe(false);

    expect(status.aggregates?.overallScore).toBeCloseTo(11 / 12);
    expect(status.aggregates?.casesPassed).toBe(2);
    expect(status.aggregates?.casesTotal).toBe(2);
    expect(status.aggregates?.meanDelta).toBeCloseTo(0.75);
    expect(status.aggregates?.casesNotRun).toBe(1);
    expect(status.triesFinished).toBe(11);
    expect(status.costUsd).toBeCloseTo(1.2);
  });

  it("holds the threshold, and leaves the score and delta unset without graded tries", () => {
    const status = create(EvalRunStatusSchema, {
      plugins: [
        create(EvalRunPluginSchema, {
          cases: [
            create(EvalRunCaseSchema, {
              caseName: "a",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries(0.5, 1),
                  }),
                }),
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries("not-graded"),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, { tries: tries(1) }),
                }),
              ],
            }),
          ],
        }),
      ],
    });
    recomputeStatus(status, 1);
    expect(status.plugins[0]!.cases[0]?.targets[0]?.passed).toBe(false);
    expect(status.plugins[0]!.cases[0]?.targets[0]?.delta).toBeUndefined();
    expect(
      status.plugins[0]!.cases[0]?.targets[1]?.withPlugin?.score,
    ).toBeUndefined();
    expect(status.plugins[0]!.cases[0]?.targets[1]?.delta).toBeUndefined();
    expect(status.aggregates?.casesPassed).toBe(0);
    expect(status.aggregates?.meanDelta).toBeUndefined();
    expect(status.aggregates?.overallScore).toBeCloseTo(0.75);
  });

  it("counts only the cases and targets whose tries ran", () => {
    const status = create(EvalRunStatusSchema, {
      plugins: [
        create(EvalRunPluginSchema, {
          cases: [
            create(EvalRunCaseSchema, {
              caseName: "ran",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, { tries: tries(1, 1) }),
                }),
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries("pending", "pending"),
                  }),
                }),
              ],
            }),
            create(EvalRunCaseSchema, {
              caseName: "stopped-before-it-ran",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries("pending", "pending"),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, {
                    tries: tries("pending", "pending"),
                  }),
                }),
              ],
            }),
            create(EvalRunCaseSchema, {
              caseName: "only-not-graded",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries("pending"),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, {
                    tries: tries("not-graded"),
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    });
    recomputeStatus(status, 1);
    // "only-not-graded" finished a try, but none was graded.
    expect(status.aggregates?.casesTotal).toBe(1);
    expect(status.aggregates?.casesPassed).toBe(1);
    expect(status.aggregates?.casesNotRun).toBe(0);
    expect(status.aggregates?.overallScore).toBe(1);
  });

  it("leaves a case whose finished tries were all not graded out of the totals, so platform failures never read as failed cases", () => {
    const status = create(EvalRunStatusSchema, {
      plugins: [
        create(EvalRunPluginSchema, {
          cases: [
            create(EvalRunCaseSchema, {
              caseName: "graded",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries(0, "not-graded"),
                  }),
                }),
              ],
            }),
            create(EvalRunCaseSchema, {
              caseName: "platform-failures",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries("not-graded", "not-graded"),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, {
                    tries: tries("not-graded", "not-graded"),
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    });
    recomputeStatus(status, 1);
    expect(status.aggregates).toMatchObject({
      casesTotal: 1,
      casesPassed: 0,
      casesNotRun: 0,
      overallScore: 0,
    });
    expect(status.triesFinished).toBe(6);
  });

  it("leaves a case out of the totals when only its without-plugin tries were graded, whatever they scored", () => {
    const status = create(EvalRunStatusSchema, {
      plugins: [
        create(EvalRunPluginSchema, {
          cases: [
            create(EvalRunCaseSchema, {
              caseName: "graded",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, { tries: tries(1) }),
                }),
              ],
            }),
            create(EvalRunCaseSchema, {
              caseName: "with-plugin-not-graded",
              targets: [
                create(EvalRunCaseTargetSchema, {
                  withPlugin: create(EvalRunArmSchema, {
                    tries: tries("not-graded", "not-graded"),
                  }),
                  withoutPlugin: create(EvalRunArmSchema, {
                    tries: tries(1, 0),
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    });
    recomputeStatus(status, 1);
    expect(status.aggregates).toMatchObject({
      casesTotal: 1,
      casesPassed: 1,
      casesNotRun: 0,
      overallScore: 1,
    });
    expect(status.aggregates?.meanDelta).toBeUndefined();
  });
});
