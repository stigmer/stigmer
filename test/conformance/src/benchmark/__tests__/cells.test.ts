// Unit arms for the cell planner: what the environment and the flags allow,
// refused by name, before anything boots.
// Domain: conformance benchmark.
//
// Pinned: the matrix is eight scenarios (seven on the bare agent, one on the
// working agent) by two harnesses; a missing Anthropic key refuses every
// native cell and every quality cell of either harness; a missing Cursor key
// refuses Cursor cells alone; a missing `stigmer` CLI refuses every cell on
// the working agent, the quality cells included, and nothing else; --only
// and --cells refuse with their own reasons; placeholder tasks are skipped
// unless asked for; parity and working cells carry their harness's registry
// id and default cells none.
import { describe, expect, it } from "vitest";
import { benchmarkCells, globMatches, planCells } from "../cells";
import type { QualityTask } from "../quality-tasks";

function task(id: string, placeholder: boolean): QualityTask {
  return { id, placeholder, turns: ["p"], files: [], checks: [], rubric: "r", criteria: [{ name: "c", description: "d", weight: 1 }] };
}

const TASKS: QualityTask[] = [task("placeholder-1", true), task("real-1", false)];

const ALL = { anthropicKey: true, cursorKey: true, stigmerCli: true };

describe("benchmarkCells", () => {
  it("is eight scenarios on two harnesses, parity and working cells pinned per harness", () => {
    const cells = benchmarkCells();
    expect(cells).toHaveLength(16);
    expect(cells.find((cell) => cell.id === "report-parity-simple/deep-agent")?.modelRequested).toBe("claude-sonnet-4.6");
    expect(cells.find((cell) => cell.id === "report-parity-simple/cursor")?.modelRequested).toBe("claude-sonnet-4-6");
    expect(cells.find((cell) => cell.id === "report-simple/cursor")?.modelRequested).toBeNull();
    expect(cells.find((cell) => cell.id === "report-parity-turn-2/deep-agent")?.scenario.prompts).toHaveLength(3);
    const working = cells.find((cell) => cell.id === "working-read-edit/cursor");
    expect(working?.scenario.agent).toBe("working");
    expect(working?.scenario.prompts).toHaveLength(3);
    expect(working?.modelRequested).toBe("claude-sonnet-4-6");
  });
});

describe("planCells", () => {
  it("with both keys runs every benchmark cell and the real quality tasks, skipping placeholders", () => {
    const plan = planCells(TASKS, ALL, { includePlaceholders: false });
    expect(plan.cells).toHaveLength(16);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/real-1/deep-agent", "quality/real-1/cursor"]);
    expect(plan.refused).toEqual([]);
  });

  it("without the Anthropic key refuses every native cell and every quality cell by name", () => {
    const plan = planCells(TASKS, { ...ALL, anthropicKey: false }, { includePlaceholders: true });
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
      "working-read-edit/deep-agent",
      "quality/placeholder-1/deep-agent",
      "quality/placeholder-1/cursor",
      "quality/real-1/deep-agent",
      "quality/real-1/cursor",
    ]);
  });

  it("a thinking run refuses the cells on a harness's default model and keeps every pinned cell", () => {
    const plan = planCells(TASKS, ALL, { includePlaceholders: false, thinking: "enabled" });
    expect(plan.cells.every((cell) => cell.modelRequested !== null)).toBe(true);
    expect(plan.cells).toHaveLength(10);
    expect(plan.refused.filter((r) => r.reason === "thinking needs a pinned model").map((r) => r.cell)).toEqual([
      "report-simple/deep-agent",
      "report-simple/cursor",
      "report-medium/deep-agent",
      "report-medium/cursor",
      "report-codegen/deep-agent",
      "report-codegen/cursor",
    ]);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/real-1/deep-agent", "quality/real-1/cursor"]);
  });

  it("without the Cursor key refuses the Cursor cells alone", () => {
    const plan = planCells(TASKS, { ...ALL, cursorKey: false }, { includePlaceholders: false });
    expect(plan.cells.every((cell) => cell.harness === "deep-agent")).toBe(true);
    expect(plan.quality.map((cell) => cell.id)).toEqual(["quality/real-1/deep-agent"]);
    expect(plan.refused.every((r) => r.reason === "missing CURSOR_API_KEY")).toBe(true);
    expect(plan.refused).toHaveLength(9);
  });

  it("without the stigmer CLI refuses the working cells and every quality cell, and runs the bare cells", () => {
    const plan = planCells(TASKS, { ...ALL, stigmerCli: false }, { includePlaceholders: false });
    expect(plan.cells).toHaveLength(14);
    expect(plan.cells.every((cell) => cell.scenario.agent === "bare")).toBe(true);
    expect(plan.quality).toEqual([]);
    expect(plan.refused).toEqual([
      { cell: "working-read-edit/deep-agent", reason: "missing stigmer CLI" },
      { cell: "working-read-edit/cursor", reason: "missing stigmer CLI" },
      { cell: "quality/real-1/deep-agent", reason: "missing stigmer CLI" },
      { cell: "quality/real-1/cursor", reason: "missing stigmer CLI" },
    ]);
  });

  it("--only and --cells refuse with their own reasons, flags before keys", () => {
    const plan = planCells([], { ...ALL, anthropicKey: false }, { only: "cursor", cells: "report-parity-*", includePlaceholders: false });
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
