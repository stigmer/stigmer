import { describe, it, expect } from "vitest";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
} from "../implement-plan-prompt.js";

describe("findApprovedPlanPath", () => {
  it("finds the plan by the legacy filename among attachment paths", () => {
    expect(
      findApprovedPlanPath([
        ".stigmer/uploads/data.csv",
        ".stigmer/uploads/plan.md",
      ]),
    ).toBe(".stigmer/uploads/plan.md");
  });

  it("finds a title-named <slug>_<id>.plan.md plan", () => {
    expect(
      findApprovedPlanPath([
        ".stigmer/uploads/data.csv",
        ".stigmer/uploads/plan-card-ux-cleanup_a1b2c3d4.plan.md",
      ]),
    ).toBe(".stigmer/uploads/plan-card-ux-cleanup_a1b2c3d4.plan.md");
  });

  it("returns undefined when no plan attachment resolved", () => {
    expect(findApprovedPlanPath([".stigmer/uploads/data.csv"])).toBeUndefined();
    expect(findApprovedPlanPath([])).toBeUndefined();
  });

  it("matches the plan convention only — a plan-adjacent filename is not the plan", () => {
    expect(
      findApprovedPlanPath([".stigmer/uploads/my-plan.md.bak"]),
    ).toBeUndefined();
    // A file merely containing "plan" is not a plan artifact.
    expect(
      findApprovedPlanPath([".stigmer/uploads/myplan.md"]),
    ).toBeUndefined();
  });
});

describe("buildImplementPlanDirective", () => {
  it("points the model at the attached plan and names it authoritative", () => {
    const directive = buildImplementPlanDirective(".stigmer/uploads/plan.md");

    expect(directive).toContain("APPROVED");
    expect(directive).toContain("`.stigmer/uploads/plan.md`");
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

  // Tier 3 (plan-driven build progress): both variants instruct the agent to
  // derive its to-do list from the plan and keep it current — the agent's todo
  // tool is the single writer of status.todos, so this instruction is the
  // entire plan→progress linkage.
  it("instructs plan-derived progress tracking in the attached variant", () => {
    const directive = buildImplementPlanDirective(".stigmer/uploads/plan.md");

    expect(directive).toContain("to-do list");
    expect(directive).toContain("break the plan into");
    expect(directive).toContain("in progress");
    expect(directive).toContain("completed");
  });

  it("instructs plan-derived progress tracking in the conversation-only variant", () => {
    const directive = buildImplementPlanDirective(undefined);

    expect(directive).toContain("to-do list");
    expect(directive).toContain("break the plan into");
    expect(directive).toContain("in progress");
    expect(directive).toContain("completed");
    // The progress block must never name the file — this variant exists
    // because no plan file materialized.
    expect(directive).not.toContain("plan.md");
  });
});
