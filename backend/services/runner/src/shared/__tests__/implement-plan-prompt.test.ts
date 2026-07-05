import { describe, it, expect } from "vitest";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
} from "../implement-plan-prompt.js";

describe("findApprovedPlanPath", () => {
  it("finds the plan by the legacy filename among attachment paths", () => {
    expect(
      findApprovedPlanPath([
        ".stigmer/inputs/data.csv",
        ".stigmer/inputs/plan.md",
      ]),
    ).toBe(".stigmer/inputs/plan.md");
  });

  it("finds a title-named <slug>.plan.md plan", () => {
    expect(
      findApprovedPlanPath([
        ".stigmer/inputs/data.csv",
        ".stigmer/inputs/plan_card_ux_cleanup.plan.md",
      ]),
    ).toBe(".stigmer/inputs/plan_card_ux_cleanup.plan.md");
  });

  it("returns undefined when no plan attachment resolved", () => {
    expect(findApprovedPlanPath([".stigmer/inputs/data.csv"])).toBeUndefined();
    expect(findApprovedPlanPath([])).toBeUndefined();
  });

  it("matches the plan convention only — a plan-adjacent filename is not the plan", () => {
    expect(
      findApprovedPlanPath([".stigmer/inputs/my-plan.md.bak"]),
    ).toBeUndefined();
    // A file merely containing "plan" is not a plan artifact.
    expect(
      findApprovedPlanPath([".stigmer/inputs/myplan.md"]),
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

  // Tier 3 (plan-driven build progress): both variants instruct the agent to
  // derive its to-do list from the plan and keep it current — the agent's todo
  // tool is the single writer of status.todos, so this instruction is the
  // entire plan→progress linkage.
  it("instructs plan-derived progress tracking in the attached variant", () => {
    const directive = buildImplementPlanDirective(".stigmer/inputs/plan.md");

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
