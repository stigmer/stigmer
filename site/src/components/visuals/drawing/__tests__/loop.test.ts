/**
 * The loop engine's rule for when a part is shown and lit, on a three-step
 * story of its own: a stage that always shows, a file handed on at the next
 * step, and a result that stays to the finished picture.
 *
 * The rules every picture's stylesheet keeps are checked against real
 * pictures (`@/__test-utils__/loop-checks`); this checks the rule itself,
 * moment by moment, including the cases no stylesheet asks about, such as
 * whether a stage is shown when the story is cleared.
 */
import { describe, expect, it } from "vitest";
import { isOn, layersOf, type LoopPart } from "../loop";

const STEPS = ["gives", "works", "returns"] as const;
type Step = (typeof STEPS)[number];

const STAGE: LoopPart<Step> = { shows: "always", lit: ["works"], litAtHold: true, layers: ["ring"] };
const FILE: LoopPart<Step> = { shows: "gives", hides: "works", lit: ["gives"], litAtHold: false, layers: ["ink"] };
const RESULT: LoopPart<Step> = { shows: "returns", lit: ["returns"], litAtHold: true, layers: ["ring", "ink"] };

describe("isOn", () => {
  it("always shows a stage, the cleared story included, and animates only its lit layers", () => {
    for (const moment of ["clear", "hold", ...STEPS] as const) expect(isOn(STEPS, STAGE, "part", moment), moment).toBe(true);
    expect(layersOf(STAGE)).toEqual(["ring"]);
  });

  it("shows a handed-on file from its step until the step it goes at, and not in the finished picture", () => {
    expect(STEPS.map((step) => isOn(STEPS, FILE, "part", step))).toEqual([true, false, false]);
    expect(isOn(STEPS, FILE, "part", "clear")).toBe(false);
    expect(isOn(STEPS, FILE, "part", "hold")).toBe(false);
    expect(layersOf(FILE)).toEqual(["part", "ink"]);
  });

  it("keeps a result from its step to the finished picture", () => {
    expect(STEPS.map((step) => isOn(STEPS, RESULT, "part", step))).toEqual([false, false, true]);
    expect(isOn(STEPS, RESULT, "part", "hold")).toBe(true);
  });

  it("lights a layer at its own steps and in the finished picture only when it says so", () => {
    expect(STEPS.map((step) => isOn(STEPS, STAGE, "ring", step))).toEqual([false, true, false]);
    expect(isOn(STEPS, STAGE, "ring", "clear")).toBe(false);
    expect(isOn(STEPS, STAGE, "ring", "hold")).toBe(true);
    expect(isOn(STEPS, FILE, "ink", "hold")).toBe(false);
  });
});
