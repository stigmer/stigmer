/**
 * Pins a run made into a test case in the console: the case is named after
 * the request, its FAIL line is seeded from the judge's failing reason
 * before the eval's and before the viewer's own thumbs-down comment, a
 * thumbs-up comment seeds nothing, a run that continued a conversation
 * carries the note, and the zip holds the case under one directory named
 * after it.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { strFromU8, unzipSync } from "fflate";
import {
  ScoreSchema,
  type Score,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { MULTI_TURN_NOTE } from "@stigmer/sdk";
import { testCaseOfRun, zipTestCase } from "../test-case";

const VIEWER = { accountId: "ida_me", subject: "" };

function graded(metric: string, source: ScoreSource, reason: string): Score {
  return create(ScoreSchema, {
    spec: {
      runId: "run_1",
      metric,
      source,
      value: { case: "passed", value: false },
      criteria: [
        { name: "first", result: CriterionResult.passed, reason: "fine" },
        { name: "second", result: CriterionResult.failed, reason },
      ],
    },
  });
}

function thumbs(up: boolean, comment: string): Score {
  return create(ScoreSchema, {
    spec: {
      runId: "run_1",
      metric: "feedback",
      source: ScoreSource.human,
      value: { case: "passed", value: up },
      comment,
    },
    status: { audit: { specAudit: { createdBy: { id: "ida_me" } } } },
  });
}

function criteriaOf(scores: Score[], multiTurn = false) {
  const testCase = testCaseOfRun({
    request: "Look over my diff",
    scores,
    viewer: VIEWER,
    multiTurn,
  });
  return {
    testCase,
    criteria:
      testCase.files.find((file) => file.path === "graders/criteria.md")
        ?.content ?? "",
  };
}

describe("testCaseOfRun", () => {
  it("names the case after the request and seeds the FAIL line from the judge first", () => {
    const { testCase, criteria } = criteriaOf([
      thumbs(false, "missed the bug"),
      graded("eval", ScoreSource.eval, "the skill was not read"),
      graded("judge", ScoreSource.judge, "said nothing about the null check"),
    ]);
    expect(testCase.caseName).toBe("look-over-my-diff");
    expect(criteria).toContain("made from: said nothing about the null check.");
  });

  it("falls back to the eval's reason, then the viewer's thumbs-down comment", () => {
    expect(
      criteriaOf([
        thumbs(false, "missed the bug"),
        graded("eval", ScoreSource.eval, "no file written"),
      ]).criteria,
    ).toContain("made from: no file written.");
    expect(criteriaOf([thumbs(false, "missed the bug")]).criteria).toContain(
      "made from: missed the bug.",
    );
    expect(criteriaOf([thumbs(true, "great")]).criteria).toContain(
      "FAIL if <what a wrong or missing response looks like>.",
    );
  });

  it("notes a run that continued a conversation", () => {
    expect(criteriaOf([], true).testCase.note).toBe(MULTI_TURN_NOTE);
  });
});

describe("zipTestCase", () => {
  it("holds the case's files under one directory named after it", () => {
    const { testCase } = criteriaOf([]);
    const entries = unzipSync(zipTestCase(testCase));
    expect(Object.keys(entries).sort()).toEqual([
      "look-over-my-diff/graders/criteria.md",
      "look-over-my-diff/prompt.md",
    ]);
    expect(strFromU8(entries["look-over-my-diff/prompt.md"]!)).toContain(
      "Look over my diff\n",
    );
  });
});
