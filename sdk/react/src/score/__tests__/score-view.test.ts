/**
 * Pins the pure reads the score controls render from: which score is the
 * run's health and what its chip says (pending, healthy, flagged with each
 * failed check's reason, not graded with the reason), which feedback is
 * the viewer's (by account id or identity-provider subject, never another
 * person's or a check), the per-run grouping, and a plugin eval's try:
 * its verdict (an indicator-only check is not a failure), not graded with
 * the reason, nothing while pending, and the failing reason a test case is
 * seeded from (the judge's before the eval's).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  ScoreSchema,
  type Score,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import {
  evalViewOf,
  failingReasonOf,
  runHealthViewOf,
  scoresByRun,
  thumbsOf,
  viewerFeedbackOf,
} from "../score-view";

function health(
  runId: string,
  criteria: { name: string; result: CriterionResult; reason?: string }[],
): Score {
  const failed = criteria.some((c) => c.result === CriterionResult.failed);
  return create(ScoreSchema, {
    spec: {
      runId,
      metric: "run-health",
      source: ScoreSource.check,
      value: { case: "passed", value: !failed },
      criteria,
    },
    status: { state: ScoreState.graded },
  });
}

function feedback(runId: string, by: string, passed: boolean): Score {
  return create(ScoreSchema, {
    spec: {
      runId,
      metric: "feedback",
      source: ScoreSource.human,
      value: { case: "passed", value: passed },
    },
    status: {
      state: ScoreState.graded,
      audit: { specAudit: { createdBy: { id: by } } },
    },
  });
}

describe("runHealthViewOf", () => {
  it("is pending until the run-health score arrives", () => {
    expect(runHealthViewOf([feedback("run_1", "ida_1", true)])).toEqual({
      kind: "pending",
    });
  });

  it("is healthy when no check failed", () => {
    const score = health("run_1", [
      { name: "no-repeated-calls", result: CriterionResult.passed },
      {
        name: "structured-output-delivered",
        result: CriterionResult.not_applicable,
      },
    ]);
    expect(runHealthViewOf([score])).toEqual({ kind: "healthy" });
  });

  it("lists each failed check with its reason", () => {
    const score = health("run_1", [
      { name: "no-repeated-calls", result: CriterionResult.passed },
      {
        name: "last-action-succeeded",
        result: CriterionResult.failed,
        reason: "ended on a failed action: create_ticket (step 7)",
      },
    ]);
    expect(runHealthViewOf([score])).toEqual({
      kind: "flagged",
      flags: [
        {
          name: "last-action-succeeded",
          reason: "ended on a failed action: create_ticket (step 7)",
        },
      ],
    });
  });

  it("says not graded, with the reason, when grading failed", () => {
    const score = create(ScoreSchema, {
      spec: { runId: "run_1", metric: "run-health", source: ScoreSource.check },
      status: {
        state: ScoreState.not_graded,
        notGradedReason: "grading could not start",
      },
    });
    expect(runHealthViewOf([score])).toEqual({
      kind: "not-graded",
      reason: "grading could not start",
    });
  });
});

describe("viewerFeedbackOf", () => {
  const mine = feedback("run_1", "ida_me", false);
  const theirs = feedback("run_1", "ida_them", true);
  const check = health("run_1", []);

  it("finds the viewer's feedback by account id", () => {
    expect(
      viewerFeedbackOf([theirs, check, mine], {
        accountId: "ida_me",
        subject: "",
      }),
    ).toBe(mine);
  });

  it("finds it by the identity-provider subject", () => {
    const bySubject = feedback("run_1", "auth0|me", true);
    expect(
      viewerFeedbackOf([theirs, bySubject], {
        accountId: "ida_me",
        subject: "auth0|me",
      }),
    ).toBe(bySubject);
  });

  it("finds none without a viewer, or when only others rated", () => {
    expect(viewerFeedbackOf([mine], null)).toBeUndefined();
    expect(
      viewerFeedbackOf([theirs], { accountId: "ida_me", subject: "" }),
    ).toBeUndefined();
  });

  it("reads thumbs down as false, not as no rating", () => {
    expect(thumbsOf(mine)).toBe(false);
    expect(thumbsOf(undefined)).toBeUndefined();
  });
});

describe("scoresByRun", () => {
  it("groups a session's scores by run", () => {
    const a = feedback("run_a", "ida_1", true);
    const b = health("run_b", []);
    const grouped = scoresByRun([a, b, feedback("run_a", "ida_2", false)]);
    expect(grouped.get("run_a")).toHaveLength(2);
    expect(grouped.get("run_b")).toEqual([b]);
  });

  it("files no score that names no run", () => {
    const grouped = scoresByRun([
      health("", []),
      feedback("run_a", "ida_1", true),
    ]);
    expect([...grouped.keys()]).toEqual(["run_a"]);
  });
});

describe("a plugin eval's try", () => {
  function graded(
    metric: string,
    source: ScoreSource,
    failedReason: string | null,
    state = ScoreState.graded,
  ): Score {
    return create(ScoreSchema, {
      spec: {
        runId: "run_a",
        metric,
        source,
        value: { case: "passed", value: failedReason === null },
        criteria: [
          {
            name: "skill-fired",
            result: CriterionResult.not_applicable,
            reason: "indicator only",
          },
          ...(failedReason === null
            ? []
            : [
                {
                  name: "criteria",
                  result: CriterionResult.failed,
                  reason: failedReason,
                },
              ]),
        ],
      },
      status: {
        state,
        notGradedReason: state === ScoreState.not_graded ? "platform busy" : "",
      },
    });
  }

  it("reads its verdict, counting only failed checks", () => {
    expect(evalViewOf([graded("eval", ScoreSource.eval, null)])).toMatchObject({
      kind: "graded",
      passed: true,
      failed: 0,
    });
    expect(
      evalViewOf([graded("eval", ScoreSource.eval, "no file")]),
    ).toMatchObject({ kind: "graded", passed: false, failed: 1 });
  });

  it("says why it was not graded, and shows nothing while pending or for another source", () => {
    expect(
      evalViewOf([
        graded("eval", ScoreSource.eval, null, ScoreState.not_graded),
      ]),
    ).toEqual({
      kind: "not-graded",
      reason: "platform busy",
    });
    expect(
      evalViewOf([graded("eval", ScoreSource.eval, null, ScoreState.pending)]),
    ).toEqual({ kind: "none" });
    expect(evalViewOf([graded("judge", ScoreSource.judge, "x")])).toEqual({
      kind: "none",
    });
  });

  it("seeds a test case from the judge's failing reason before the eval's", () => {
    const evalFail = graded("eval", ScoreSource.eval, "no file");
    expect(failingReasonOf([evalFail])).toBe("no file");
    expect(
      failingReasonOf([
        evalFail,
        graded("judge", ScoreSource.judge, "made it up"),
      ]),
    ).toBe("made it up");
    expect(failingReasonOf([graded("eval", ScoreSource.eval, null)])).toBe("");
  });
});
