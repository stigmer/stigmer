// Pins the shape of the example set the AI judge's rules are held to
// (judge/examples): every example names exactly the judge's current rubrics,
// each rubric has enough expected passes and fails to measure both
// directions, ids are unique, and every example renders within the judge's
// bounds without a cut, so the judge sees all of it.
// Domain: conformance benchmark (the judge's calibration).
import { RUBRICS, SUBJECT_MAX_LENGTH, renderSubject } from "@stigmer/eval-runtime";
import { describe, expect, it } from "vitest";

import { JUDGE_EXAMPLES } from "../judge/examples";
import { examplesDigest } from "../judge/example";

/** Expected passes and expected fails each rubric needs, counted apart. */
const FLOOR = 10;

/** Expected not-applicable cases a rubric that allows one needs. */
const NOT_APPLICABLE_FLOOR = 5;

describe("the judge's example set", () => {
  it("names exactly the judge's rubrics in every example", () => {
    const names = RUBRICS.map((rubric) => rubric.name).sort();
    for (const example of JUDGE_EXAMPLES) {
      expect(Object.keys(example.expected).sort(), example.id).toEqual(names);
    }
  });

  it("gives every rubric at least ten expected passes and ten expected fails, and not-applicable cases only where its text allows one", () => {
    for (const rubric of RUBRICS) {
      const results = JUDGE_EXAMPLES.map((example) => example.expected[rubric.name]);
      const count = (result: string) => results.filter((r) => r === result).length;
      expect(count("passed"), `${rubric.name} passes`).toBeGreaterThanOrEqual(FLOOR);
      expect(count("failed"), `${rubric.name} fails`).toBeGreaterThanOrEqual(FLOOR);
      if (rubric.text.includes("Not applicable")) {
        expect(count("not_applicable"), `${rubric.name} not applicable`).toBeGreaterThanOrEqual(NOT_APPLICABLE_FLOOR);
      } else {
        expect(count("not_applicable"), `${rubric.name} has no not-applicable reading`).toBe(0);
      }
    }
  });

  it("gives every example a unique kebab-case id, a line about it and a reason", () => {
    const ids = JUDGE_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of JUDGE_EXAMPLES) {
      expect(example.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(example.about.trim(), example.id).not.toBe("");
      expect(example.why.trim(), example.id).not.toBe("");
    }
  });

  it("renders every example within the judge's bounds, with no earlier turn dropped", () => {
    for (const example of JUDGE_EXAMPLES) {
      const text = renderSubject(example.parts);
      expect(text.length, example.id).toBeLessThanOrEqual(SUBJECT_MAX_LENGTH);
      expect(text, example.id).not.toContain("elided_");
    }
  });

  it("digests the set as written, so an edited example changes the digest", () => {
    const [first, ...rest] = JUDGE_EXAMPLES;
    if (first === undefined) throw new Error("the set is empty");
    expect(examplesDigest(JUDGE_EXAMPLES)).toMatch(/^[0-9a-f]{64}$/);
    expect(examplesDigest([{ ...first, why: `${first.why} ` }, ...rest])).not.toBe(examplesDigest(JUDGE_EXAMPLES));
  });
});
