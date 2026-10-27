// The accessibility policy's verdicts (../axe-policy.ts): critical and
// serious violations fail, contrast as much as any; moderate and minor ones
// pass as advisory; a rule listed against an open issue is reported, not
// failing, and a listed rule that no longer fails is stale.
// Domain: test support (shared assertions).
import { describe, expect, it } from "vitest";
import { describeJudgement, describeViolations, judgeAxe, type AxeViolation } from "../axe-policy.ts";

function violation(id: string, impact: string | null, nodes = 1): AxeViolation {
  return {
    id,
    impact,
    help: `${id} help`,
    nodes: Array.from({ length: nodes }, (_, i) => ({ target: [`#el-${i}`], html: `<div id="el-${i}">` })),
  };
}

describe("judgeAxe", () => {
  it("fails a critical or serious violation, contrast included", () => {
    const judged = judgeAxe([violation("color-contrast", "serious"), violation("button-name", "critical")]);
    expect(judged.failing.map((v) => v.id)).toEqual(["color-contrast", "button-name"]);
    expect(judged.advisory).toEqual([]);
  });

  it("reports a moderate, minor or unrated violation as advisory, never failing", () => {
    const judged = judgeAxe([violation("region", "moderate"), violation("list", "minor"), violation("odd", null)]);
    expect(judged.failing).toEqual([]);
    expect(judged.advisory.map((v) => v.id)).toEqual(["region", "list", "odd"]);
  });

  it("passes a blocking violation its screen lists against an open issue, and reports it", () => {
    const judged = judgeAxe([violation("color-contrast", "serious")], [{ rule: "color-contrast", issue: "stigmer#1" }]);
    expect(judged.failing).toEqual([]);
    expect(judged.known.map((v) => v.id)).toEqual(["color-contrast"]);
    expect(judged.stale).toEqual([]);
  });

  it("calls a listed rule stale once it no longer fails, even when it is only advisory now", () => {
    const listed = [{ rule: "color-contrast", issue: "stigmer#1" }];
    expect(judgeAxe([], listed).stale).toEqual(listed);
    expect(judgeAxe([violation("color-contrast", "moderate")], listed).stale).toEqual(listed);
  });

  it("fails a blocking rule the list does not name beside one it does", () => {
    const judged = judgeAxe(
      [violation("color-contrast", "serious"), violation("label", "critical")],
      [{ rule: "color-contrast", issue: "stigmer#1" }],
    );
    expect(judged.failing.map((v) => v.id)).toEqual(["label"]);
  });
});

describe("describeViolations", () => {
  it("names the impact, rule, help and count, and the first elements", () => {
    const text = describeViolations([violation("label", "critical", 7)], 2);
    expect(text).toContain("[critical] label: label help (7 node(s))");
    expect(text).toContain("#el-0");
    expect(text).toContain("#el-1");
    expect(text).not.toContain("#el-2");
    expect(text).toContain("… and 5 more");
  });
});

describe("describeJudgement", () => {
  it("says nothing for a clean audit", () => {
    expect(describeJudgement(judgeAxe([]))).toBe("");
  });

  it("puts what fails first, then what to unlist, what is known and what is advisory", () => {
    const text = describeJudgement(
      judgeAxe(
        [violation("label", "critical"), violation("color-contrast", "serious"), violation("region", "moderate")],
        [
          { rule: "color-contrast", issue: "stigmer#1" },
          { rule: "button-name", issue: "stigmer#2" },
        ],
      ),
    );
    const order = ["failing:", "no longer failing", "known, tracked", "advisory"].map((heading) => text.indexOf(heading));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("button-name (stigmer#2)");
  });
});
