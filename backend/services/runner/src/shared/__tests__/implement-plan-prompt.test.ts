import { describe, it, expect } from "vitest";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
} from "../implement-plan-prompt.js";

describe("findApprovedPlanPath", () => {
  it("finds the plan by its canonical filename among attachment paths", () => {
    expect(
      findApprovedPlanPath([
        ".stigmer/inputs/data.csv",
        ".stigmer/inputs/plan.md",
      ]),
    ).toBe(".stigmer/inputs/plan.md");
  });

  it("returns undefined when no plan attachment resolved", () => {
    expect(findApprovedPlanPath([".stigmer/inputs/data.csv"])).toBeUndefined();
    expect(findApprovedPlanPath([])).toBeUndefined();
  });

  it("matches the basename exactly — a plan-adjacent filename is not the plan", () => {
    expect(
      findApprovedPlanPath([".stigmer/inputs/my-plan.md.bak"]),
    ).toBeUndefined();
  });
});

describe("buildImplementPlanDirective", () => {
  it("points the model at the attached plan and names it authoritative", () => {
    const directive = buildImplementPlanDirective(".stigmer/inputs/plan.md");

    expect(directive).toContain("APPROVED");
    expect(directive).toContain("`.stigmer/inputs/plan.md`");
    expect(directive).toContain("Read it FIRST");
    // The user may have edited the document after the plan turn — the file,
    // not the conversation, is the approved text.
    expect(directive).toContain("authoritative");
  });

  it("falls back to the conversation's plan when nothing is attached", () => {
    const directive = buildImplementPlanDirective(undefined);

    expect(directive).toContain("APPROVED");
    expect(directive).toContain("conversation above");
    expect(directive).not.toContain("plan.md");
  });
});
