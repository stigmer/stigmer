// Unit arms for the cell planner: what the environment and the flags allow,
// refused by name, before anything boots.
// Domain: conformance benchmark.
//
// Pinned: the matrix is seven scenarios by two harnesses; a missing Anthropic
// key refuses every native cell and every quality cell of either harness; a
// missing Cursor key refuses Cursor cells alone; --only and --cells refuse
// with their own reasons; placeholder tasks are skipped unless asked for;
// parity cells carry their harness's registry id and default cells none.
import { describe, expect, it } from "vitest";
import { benchmarkCells, globMatches, planCells, type QualityTask } from "../cells";

const TASKS: QualityTask[] = [
  { id: "placeholder-1", prompt: "p", rubric: "r", placeholder: true },
  { id: "real-1", prompt: "p", rubric: "r", placeholder: false },
];

describe("benchmarkCells", () => {
  it("is seven scenarios on two harnesses, parity cells pinned per harness", () => {
    const cells = benchmarkCells();
    expect(cells).toHaveLength(14);
    expect(cells.find((cell) => cell.id === "report-parity-simple/deep-agent")?.modelRequested).toBe("claude-sonnet-4.6");
    expect(cells.find((cell) => cell.id === "report-parity-simple/cursor")?.modelRequested).toBe("claude-sonnet-4-6");
    expect(cells.find((cell) => cell.id === "report-simple/cursor")?.modelRequested).toBeNull();
    expect(cells.find((cell) => cell.id === "report-parity-turn-2/deep-agent")?.scenario.prompts).toHaveLength(3);
  });
});

describe("planCells", () => {
  it("with both keys runs every benchmark cell and the real quality tasks, skipping placeholders", () => {
    const plan = planCells(TASKS, { anthropicKey: true, cursorKey: true }, { includePlaceholders: false });
    expect(plan.cells).toHaveLength(14);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/real-1/deep-agent", "quality/real-1/cursor"]);
    expect(plan.refused).toEqual([]);
  });

  it("without the Anthropic key refuses every native cell and every quality cell by name", () => {
    const plan = planCells(TASKS, { anthropicKey: false, cursorKey: true }, { includePlaceholders: true });
    expect(plan.cells.every((cell) => cell.harness === "cursor")).toBe(true);
    expect(plan.quality).toEqual([]);
    expect(plan.refused.filter((r) => r.reason === "missing ANTHROPIC_API_KEY").map((r) => r.cell)).toEqual([
      "report-simple/deep-agent",
      "report-medium/deep-agent",
      "report-codegen/deep-agent",
      "report-parity-simple/deep-agent",
      "report-parity-medium/deep-agent",
      "report-parity-codegen/deep-agent",
      "report-parity-turn-2/deep-agent",
      "quality/placeholder-1/deep-agent",
      "quality/placeholder-1/cursor",
      "quality/real-1/deep-agent",
      "quality/real-1/cursor",
    ]);
  });

  it("without the Cursor key refuses the Cursor cells alone", () => {
    const plan = planCells(TASKS, { anthropicKey: true, cursorKey: false }, { includePlaceholders: false });
    expect(plan.cells.every((cell) => cell.harness === "deep-agent")).toBe(true);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/real-1/deep-agent"]);
    expect(plan.refused.every((r) => r.reason === "missing CURSOR_API_KEY")).toBe(true);
    expect(plan.refused).toHaveLength(8);
  });

  it("--only and --cells refuse with their own reasons, flags before keys", () => {
    const plan = planCells([], { anthropicKey: false, cursorKey: true }, { only: "cursor", cells: "report-parity-*", includePlaceholders: false });
    expect(plan.cells.map((cell) => cell.id)).toEqual([
      "report-parity-simple/cursor",
      "report-parity-medium/cursor",
      "report-parity-codegen/cursor",
      "report-parity-turn-2/cursor",
    ]);
    expect(plan.refused.find((r) => r.cell === "report-simple/deep-agent")?.reason).toBe("excluded by --only");
    expect(plan.refused.find((r) => r.cell === "report-simple/cursor")?.reason).toBe("excluded by --cells");
  });
});

describe("globMatches", () => {
  it("treats * as any run of characters and everything else literally", () => {
    expect(globMatches("report-parity-*", "report-parity-simple/cursor")).toBe(true);
    expect(globMatches("*/cursor", "report-simple/cursor")).toBe(true);
    expect(globMatches("report-simple/cursor", "report-simple/deep-agent")).toBe(false);
    expect(globMatches("report.simple/cursor", "reportXsimple/cursor")).toBe(false);
  });
});
