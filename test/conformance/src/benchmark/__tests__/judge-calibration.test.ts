// Holds the AI judge's rules to their last calibration on a real model
// (judge/calibration.ts): the committed counts must be for the judge's
// current evaluator version and the example set as it stands, and must meet
// the bar. So neither a rubric, the judge's message, how a subject is
// written nor an example changes without a fresh real-model run that meets
// the bar, and CI spends no model money proving it.
// Domain: conformance benchmark (the judge's calibration).
import { JUDGE_EVALUATOR_VERSION } from "@stigmer/eval-runtime/judge";
import { describe, expect, it } from "vitest";

import { JUDGE_CALIBRATION } from "../judge/calibration";
import { shortfallsOf } from "../judge/calibration-tally";
import { examplesDigest } from "../judge/example";
import { JUDGE_EXAMPLES } from "../judge/examples";

const RECALIBRATE = 'run `make benchmark-harnesses BENCHMARK_ARGS="--cells judge/* --write-calibration"` with ANTHROPIC_API_KEY set';

describe("the judge's calibration", () => {
  it("is recorded for the judge's current rules and the example set as it stands, and meets the bar", () => {
    expect(JUDGE_CALIBRATION, `the judge has never been calibrated: ${RECALIBRATE}`).toBeDefined();
    if (JUDGE_CALIBRATION === undefined) return;
    expect(JUDGE_CALIBRATION.evaluatorVersion, `the judge's rules changed since the calibration: ${RECALIBRATE}`).toBe(
      JUDGE_EVALUATOR_VERSION,
    );
    expect(JUDGE_CALIBRATION.examplesDigest, `the examples changed since the calibration: ${RECALIBRATE}`).toBe(
      examplesDigest(JUDGE_EXAMPLES),
    );
    expect(shortfallsOf(JUDGE_CALIBRATION), "the calibration is below the bar").toEqual([]);
  });
});
