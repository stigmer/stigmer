// Pins the judge calibration's counts (judge/calibration-tally.ts): fails
// caught, passes kept and not applicable matched are counted apart per
// rubric; an unreadable try is a miss in every direction and counted on its
// own; the bar refuses below 90% caught or kept, below 80% matched, and any
// unreadable verdict; the generated module reads back as the counts; and
// the judge cell caps each grade as the server caps a live grade's judge run.
// Domain: conformance benchmark (the judge's calibration).
import { describe, expect, it } from "vitest";

import { PER_GRADE_CAP_USD } from "../judge/calibrate";
import {
  renderCalibrationModule,
  shortfallsOf,
  tallyCalibration,
  type CalibrationTry,
  type JudgeCalibration,
} from "../judge/calibration-tally";
import type { JudgeExample } from "../judge/example";

const parts = { earlierTurns: [], request: "r", toolCalls: [], answer: "a" };

const EXAMPLES: JudgeExample[] = [
  { id: "one", about: "a", parts, expected: { task: "failed", claims: "not_applicable" }, why: "w" },
  { id: "two", about: "a", parts, expected: { task: "passed", claims: "passed" }, why: "w" },
];

const META = { evaluatorVersion: "v", examplesDigest: "d", model: "m", tries: 2, date: "2026-10-12" };

function attempt(exampleId: string, task: "passed" | "failed", claims: "passed" | "not_applicable", costUsd = 0.01): CalibrationTry {
  return {
    exampleId,
    verdicts: [
      { name: "task", result: task, reason: "x" },
      { name: "claims", result: claims, reason: "x" },
    ],
    costUsd,
  };
}

describe("tallyCalibration", () => {
  it("counts each direction apart per rubric, an unreadable try as a miss everywhere, and the cost per grade", () => {
    const { calibration, misses } = tallyCalibration(
      EXAMPLES,
      ["task", "claims"],
      [
        attempt("one", "failed", "not_applicable"),
        attempt("one", "passed", "not_applicable", 0.03),
        attempt("two", "passed", "passed"),
        { exampleId: "two", verdicts: undefined, costUsd: 0.02 },
      ],
      META,
    );
    expect(calibration.grades).toBe(4);
    expect(calibration.expectedGrades).toBe(4);
    expect(calibration.unreadable).toBe(1);
    expect(calibration.costPerGradeUsd).toEqual({ mean: 0.0175, max: 0.03 });
    expect(calibration.rubrics).toEqual([
      { name: "task", failsCaught: { n: 1, of: 2 }, passesKept: { n: 1, of: 2 }, notApplicableMatched: { n: 0, of: 0 } },
      { name: "claims", failsCaught: { n: 0, of: 0 }, passesKept: { n: 1, of: 2 }, notApplicableMatched: { n: 2, of: 2 } },
    ]);
    expect(misses).toEqual([
      { exampleId: "one", rubric: "task", expected: "failed", got: "passed" },
      { exampleId: "two", rubric: "task", expected: "passed", got: "unreadable" },
      { exampleId: "two", rubric: "claims", expected: "passed", got: "unreadable" },
    ]);
  });

  it("refuses a try for an example the set does not hold, and an example with no verdict for a rubric", () => {
    expect(() => tallyCalibration(EXAMPLES, ["task"], [attempt("three", "passed", "passed")], META)).toThrow(/three/);
    expect(() => tallyCalibration(EXAMPLES, ["tone"], [attempt("one", "passed", "passed")], META)).toThrow(/tone/);
  });
});

describe("shortfallsOf", () => {
  const meeting: JudgeCalibration = {
    ...META,
    expectedGrades: 30,
    grades: 30,
    unreadable: 0,
    costPerGradeUsd: { mean: 0.01, max: 0.02 },
    rubrics: [{ name: "task", failsCaught: { n: 9, of: 10 }, passesKept: { n: 18, of: 20 }, notApplicableMatched: { n: 4, of: 5 } }],
  };

  it("meets the bar at exactly 90% caught and kept and 80% matched", () => {
    expect(shortfallsOf(meeting)).toEqual([]);
  });

  it("names each direction below the bar, an unreadable verdict and an empty run", () => {
    const below: JudgeCalibration = {
      ...meeting,
      unreadable: 2,
      rubrics: [{ name: "task", failsCaught: { n: 8, of: 10 }, passesKept: { n: 17, of: 20 }, notApplicableMatched: { n: 3, of: 5 } }],
    };
    expect(shortfallsOf(below)).toEqual([
      "2 verdicts could not be read",
      "task: expected fails caught 8 of 10, below 90%",
      "task: expected passes kept 17 of 20, below 90%",
      "task: not applicable matched 3 of 5, below 80%",
    ]);
    expect(shortfallsOf({ ...meeting, grades: 0 })).toEqual(["no example was graded"]);
    expect(shortfallsOf({ ...meeting, grades: 12 }), "a run its budget cut short").toEqual([
      "only 12 of 30 tries were graded",
    ]);
  });
});

describe("renderCalibrationModule", () => {
  it("writes a generated module whose constant is the counts", () => {
    const source = renderCalibrationModule({
      ...META,
      expectedGrades: 1,
      grades: 1,
      unreadable: 0,
      costPerGradeUsd: { mean: 0, max: 0 },
      rubrics: [],
    });
    expect(source.startsWith("// GENERATED")).toBe(true);
    const literal = source.slice(source.indexOf("= ") + 2, source.lastIndexOf(";"));
    expect(JSON.parse(literal)).toMatchObject({ evaluatorVersion: "v", examplesDigest: "d", grades: 1 });
  });
});

describe("the judge cell", () => {
  it("caps each grade at the server's per-grade cap, $0.25 (domain/score/judge/judge-run.ts)", () => {
    expect(PER_GRADE_CAP_USD).toBe(0.25);
  });
});
