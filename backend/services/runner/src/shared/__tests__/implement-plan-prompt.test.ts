/**
 * The Build-from-plan directive (`shared/implement-plan-prompt.ts`).
 *
 * Pinned:
 *  - the approved plan is found among this message's Files by the File's own
 *    filename against the plan convention (`*.plan.md`), and
 *    answered by its mount path, so a plan the server mounted at
 *    `x.plan-2.md` is found; a plan-adjacent name is not a plan;
 *  - the attached variant points at that path and names the document
 *    authoritative; the conversation-only variant never names a plan file;
 *  - both variants carry the plan-derived progress-tracking instruction.
 */
import { describe, it, expect } from "vitest";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
  type PlanCandidate,
} from "../implement-plan-prompt.js";

/** A message File mounted at `.stigmer/uploads/<mountPath>`, named `filename` (the mount path's own name by default). */
function carried(mountPath: string, filename = mountPath.split("/").pop()!): PlanCandidate {
  return { filename, relativePath: `.stigmer/uploads/${mountPath}` };
}

describe("findApprovedPlanPath", () => {
  it("finds a title-named <slug>_<id>.plan.md plan", () => {
    expect(
      findApprovedPlanPath([carried("data.csv"), carried("plan-card-ux-cleanup_a1b2c3d4.plan.md")]),
    ).toBe(".stigmer/uploads/plan-card-ux-cleanup_a1b2c3d4.plan.md");
  });

  it("finds a plan the server mounted under a taken name by its filename, answering the mount path", () => {
    expect(findApprovedPlanPath([carried("x.plan-2.md", "x.plan.md")])).toBe(".stigmer/uploads/x.plan-2.md");
  });

  it("returns undefined when no plan attachment resolved", () => {
    expect(findApprovedPlanPath([carried("data.csv")])).toBeUndefined();
    expect(findApprovedPlanPath([])).toBeUndefined();
  });

  it("matches the plan convention only — a plan-adjacent filename is not the plan", () => {
    expect(findApprovedPlanPath([carried("my-plan.md.bak")])).toBeUndefined();
    // A file merely containing "plan" is not a plan.
    expect(findApprovedPlanPath([carried("myplan.md")])).toBeUndefined();
    // A bare plan.md is a file like any other.
    expect(findApprovedPlanPath([carried("plan.md")])).toBeUndefined();
  });

  it("judges the filename, never the mount path: a non-plan File at a plan-shaped path is not the plan", () => {
    expect(findApprovedPlanPath([carried("notes.plan.md", "notes.md")])).toBeUndefined();
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
