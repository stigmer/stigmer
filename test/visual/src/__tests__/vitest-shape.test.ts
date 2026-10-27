// The visual suite's reporter (../../reporter/vitest-shape.ts): a
// Playwright run folded into vitest's report shape, keyed as the integrity
// tool's inventory keys a case, so the UX scorecard reads it.
import type { Suite, TestCase } from "@playwright/test/reporter";
import { describe, expect, it } from "vitest";
import { collectReport, describesOf, statusOf } from "../../reporter/vitest-shape.ts";

describe("statusOf", () => {
  it("reads a pass and a skip as such, and a timeout or an interruption as a failure", () => {
    expect(statusOf("passed")).toBe("passed");
    expect(statusOf("skipped")).toBe("skipped");
    expect(statusOf("failed")).toBe("failed");
    expect(statusOf("timedOut")).toBe("failed");
    expect(statusOf("interrupted")).toBe("failed");
  });
});

describe("describesOf", () => {
  it("keeps the describe chain and drops the root, the project and the file", () => {
    const root = { type: "root", title: "", parent: undefined } as unknown as Suite;
    const project = { type: "project", title: "", parent: root } as unknown as Suite;
    const file = { type: "file", title: "gallery.spec.ts", parent: project } as unknown as Suite;
    const outer = { type: "describe", title: "KIT-03 the look changes only on purpose", parent: file } as unknown as Suite;
    const inner = { type: "describe", title: "threads", parent: outer } as unknown as Suite;
    expect(describesOf({ parent: inner } as unknown as TestCase)).toEqual(["KIT-03 the look changes only on purpose", "threads"]);
    expect(describesOf({ parent: file } as unknown as TestCase)).toEqual([]);
  });
});

describe("collectReport", () => {
  it("groups cases by file with their keys, statuses and only a failure's messages", () => {
    const report = collectReport([
      { file: "/r/a.spec.ts", describes: ["KIT-03 look"], title: "x looks as approved", outcome: "passed", errors: [] },
      { file: "/r/a.spec.ts", describes: ["KIT-03 look"], title: "y looks as approved", outcome: "failed", errors: ["1 pixel differs"] },
      { file: "/r/b.spec.ts", describes: [], title: "z", outcome: "skipped", errors: ["ignored"] },
    ]);
    expect(report.numTotalTests).toBe(3);
    expect(report.numFailedTests).toBe(1);
    expect(report.numPendingTests).toBe(1);
    expect(report.success).toBe(false);
    expect(report.testResults.map((f) => [f.name, f.status])).toEqual([
      ["/r/a.spec.ts", "failed"],
      ["/r/b.spec.ts", "passed"],
    ]);
    expect(report.testResults[0]?.assertionResults[1]).toEqual({
      ancestorTitles: ["KIT-03 look"],
      title: "y looks as approved",
      fullName: "KIT-03 look y looks as approved",
      status: "failed",
      failureMessages: ["1 pixel differs"],
    });
    expect(report.testResults[1]?.assertionResults[0]?.failureMessages).toEqual([]);
  });
});
