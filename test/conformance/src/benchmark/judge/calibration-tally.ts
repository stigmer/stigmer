// The AI judge's calibration as counts: what one real-model run over the
// example set (examples/) is reduced to, the bar each rubric is held to, and
// the generated module (calibration.ts) the counts are committed in.
// Domain: conformance benchmark (the judge's calibration).
//
// Each example is graded k times, and counts by the majority of its tries:
// a rubric matches an example when more than half of its tries gave the
// expected verdict. Two real-model runs of the same rules moved single tries
// by about the bar's own margin, so a single unlucky try never decides an
// example. Per rubric, three directions are counted apart, because a judge
// errs toward passing and one agreement figure hides that: the examples
// whose expected fail the judge caught, whose expected pass it kept, and
// whose expected not-applicable it matched. A try whose verdict could not be
// read counts against its example in every direction and in `unreadable`,
// which the bar allows none of. The misses stay per try, for diagnosis.
//
// The bar: every example graded k times; at least 90% of expected-fail
// examples caught and 90% of expected-pass examples kept, per rubric; not
// applicable matched on at least 80%; no unreadable verdict. The committed
// counts carry the judge's evaluator version and the examples' digest, so a
// changed rubric, message, subject or example makes them stale, and the
// staleness test (__tests__/judge-calibration.test.ts) refuses stale counts
// as it refuses counts below the bar.
//
// The counts quote nothing: rubric names, numbers, the model, a date.
import type { RubricVerdict, VerdictResultName } from "@stigmer/eval-runtime/judge";

import type { JudgeExample } from "./example";

/** The share of expected fails each rubric must catch, and of expected passes it must keep. */
export const FAILS_CAUGHT_MIN = 0.9;
export const PASSES_KEPT_MIN = 0.9;

/** The share of expected not-applicable cases each rubric must match. */
export const NOT_APPLICABLE_MATCHED_MIN = 0.8;

/** n of N examples. */
export interface Count {
  readonly n: number;
  readonly of: number;
}

/** One rubric's calibration. */
export interface RubricCalibration {
  readonly name: string;
  readonly failsCaught: Count;
  readonly passesKept: Count;
  readonly notApplicableMatched: Count;
}

/** One real-model run over the example set, as counts (the module header). */
export interface JudgeCalibration {
  /** The judge's JUDGE_EVALUATOR_VERSION the run graded with. */
  readonly evaluatorVersion: string;
  /** The examples' digest (example.ts). */
  readonly examplesDigest: string;
  /** The model the judge runs reported. */
  readonly model: string;
  /** Tries per example. */
  readonly tries: number;
  /** The UTC day of the run, YYYY-MM-DD. */
  readonly date: string;
  /** Examples times tries: what a whole run grades. */
  readonly expectedGrades: number;
  readonly grades: number;
  readonly unreadable: number;
  /** Estimated cost of one grade, in US dollars. */
  readonly costPerGradeUsd: { readonly mean: number; readonly max: number };
  readonly rubrics: ReadonlyArray<RubricCalibration>;
}

/** One try of one example: the verdicts read, or undefined when they could not be. */
export interface CalibrationTry {
  readonly exampleId: string;
  readonly verdicts: ReadonlyArray<RubricVerdict> | undefined;
  readonly costUsd: number;
}

/** A try that missed: which rubric, what was expected and what the judge said. */
export interface CalibrationMiss {
  readonly exampleId: string;
  readonly rubric: string;
  readonly expected: VerdictResultName;
  readonly got: VerdictResultName | "unreadable";
}

/** The run's counts and its misses, from its tries. */
export function tallyCalibration(
  examples: ReadonlyArray<JudgeExample>,
  rubrics: ReadonlyArray<string>,
  tries: ReadonlyArray<CalibrationTry>,
  meta: Pick<JudgeCalibration, "evaluatorVersion" | "examplesDigest" | "model" | "tries" | "date">,
): { readonly calibration: JudgeCalibration; readonly misses: ReadonlyArray<CalibrationMiss> } {
  const byId = new Map(examples.map((example) => [example.id, example]));
  const counts = new Map(
    rubrics.map((name) => [name, { failed: [0, 0], passed: [0, 0], not_applicable: [0, 0] } as Record<VerdictResultName, [number, number]>]),
  );
  const misses: CalibrationMiss[] = [];
  let unreadable = 0;
  // Per rubric and example: [tries matched, tries graded].
  const perExample = new Map<string, [number, number]>();
  for (const attempt of tries) {
    const example = byId.get(attempt.exampleId);
    if (example === undefined) {
      throw new Error(`a calibration try names an example the set does not hold: ${attempt.exampleId}`);
    }
    if (attempt.verdicts === undefined) {
      unreadable += 1;
    }
    for (const name of rubrics) {
      const expected = example.expected[name];
      const tally = counts.get(name);
      if (expected === undefined || tally === undefined) {
        throw new Error(`example ${example.id} states no verdict for ${name}`);
      }
      const got = attempt.verdicts?.find((verdict) => verdict.name === name)?.result ?? "unreadable";
      const key = `${name}\u0000${example.id}`;
      const seen = perExample.get(key) ?? [0, 0];
      seen[1] += 1;
      if (got === expected) {
        seen[0] += 1;
      } else {
        misses.push({ exampleId: example.id, rubric: name, expected, got });
      }
      perExample.set(key, seen);
    }
  }
  for (const example of examples) {
    for (const name of rubrics) {
      const seen = perExample.get(`${name}\u0000${example.id}`);
      const expected = example.expected[name];
      const tally = counts.get(name);
      if (seen === undefined || expected === undefined || tally === undefined) {
        continue;
      }
      tally[expected][1] += 1;
      if (seen[0] * 2 > seen[1]) {
        tally[expected][0] += 1;
      }
    }
  }
  const costs = tries.map((attempt) => attempt.costUsd);
  const mean = costs.length === 0 ? 0 : costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
  return {
    calibration: {
      ...meta,
      expectedGrades: examples.length * meta.tries,
      grades: tries.length,
      unreadable,
      costPerGradeUsd: { mean: roundCost(mean), max: roundCost(Math.max(0, ...costs)) },
      rubrics: rubrics.map((name) => {
        const tally = counts.get(name)!;
        return {
          name,
          failsCaught: { n: tally.failed[0], of: tally.failed[1] },
          passesKept: { n: tally.passed[0], of: tally.passed[1] },
          notApplicableMatched: { n: tally.not_applicable[0], of: tally.not_applicable[1] },
        };
      }),
    },
    misses,
  };
}

/** Each way `calibration` falls short of the bar, in words; empty when it meets it. */
export function shortfallsOf(calibration: JudgeCalibration): string[] {
  const shortfalls: string[] = [];
  if (calibration.grades === 0) {
    shortfalls.push("no example was graded");
  } else if (calibration.grades < calibration.expectedGrades) {
    shortfalls.push(`only ${calibration.grades} of ${calibration.expectedGrades} tries were graded`);
  }
  if (calibration.unreadable > 0) {
    shortfalls.push(`${calibration.unreadable} verdicts could not be read`);
  }
  for (const rubric of calibration.rubrics) {
    const below = (what: string, count: Count, min: number): void => {
      if (count.of > 0 && count.n < Math.ceil(min * count.of)) {
        shortfalls.push(`${rubric.name}: ${what} ${count.n} of ${count.of}, below ${Math.round(min * 100)}%`);
      }
    };
    below("expected fails caught", rubric.failsCaught, FAILS_CAUGHT_MIN);
    below("expected passes kept", rubric.passesKept, PASSES_KEPT_MIN);
    below("not applicable matched", rubric.notApplicableMatched, NOT_APPLICABLE_MATCHED_MIN);
  }
  return shortfalls;
}

/** The generated calibration module's source (calibration.ts), never edited by hand. */
export function renderCalibrationModule(calibration: JudgeCalibration): string {
  return [
    "// GENERATED by the benchmark's judge cell (`make benchmark-harnesses",
    '// BENCHMARK_ARGS="--cells judge/* --write-calibration"`); never edit by hand.',
    "// The AI judge's last calibration on a real model over the example set, as",
    "// counts (calibration-tally.ts). __tests__/judge-calibration.test.ts refuses it",
    "// when it is stale or below the bar.",
    "// Domain: conformance benchmark (the judge's calibration).",
    'import type { JudgeCalibration } from "./calibration-tally";',
    "",
    `export const JUDGE_CALIBRATION: JudgeCalibration | undefined = ${JSON.stringify(calibration, null, 2)};`,
    "",
  ].join("\n");
}

function roundCost(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}
