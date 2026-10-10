/**
 * Pins the Evals tab's pure rules: the form's limits and the create input
 * its settings become (named for the plugin and the moment, the targets'
 * engines, the comparison as the ablation), an eval read as one row per
 * case with a cell per target and each try summarised (a try the platform
 * could not grade shows why, never 0), the phase words, and two evals
 * compared case by case with moved and one-sided cases flagged.
 */
import { describe, expect, it } from "vitest";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  DEFAULT_EVAL_FORM,
  compareEvals,
  evalCaseRowsOf,
  evalFormProblem,
  evalTargetLabelsOf,
  formatDelta,
  isEvalActive,
  phaseLabel,
  pluginEvalInputOf,
} from "../eval-view";
import { GPT, SONNET, evalWith } from "./eval-fixture";

describe("the Run evals form", () => {
  it("starts from one native target, three tries, compared, $5, one at a time", () => {
    expect(DEFAULT_EVAL_FORM).toEqual({
      targets: [{ harness: "native", modelName: "" }],
      runs: 3,
      compare: true,
      maxCostUsd: 5,
      concurrency: 1,
    });
    expect(evalFormProblem(DEFAULT_EVAL_FORM)).toBeNull();
  });

  it("refuses settings the API refuses, in a sentence", () => {
    expect(evalFormProblem({ ...DEFAULT_EVAL_FORM, targets: [] })).toMatch(
      /one to 6 models/,
    );
    expect(evalFormProblem({ ...DEFAULT_EVAL_FORM, runs: 51 })).toMatch(
      /1 to 50/,
    );
    expect(evalFormProblem({ ...DEFAULT_EVAL_FORM, runs: 1.5 })).toMatch(
      /whole number/,
    );
    expect(evalFormProblem({ ...DEFAULT_EVAL_FORM, maxCostUsd: 0 })).toMatch(
      /more than \$0/,
    );
    expect(evalFormProblem({ ...DEFAULT_EVAL_FORM, maxCostUsd: 1001 })).toMatch(
      /at most \$1000/,
    );
    expect(
      evalFormProblem({ ...DEFAULT_EVAL_FORM, maxCostUsd: Number.NaN }),
    ).not.toBeNull();
    expect(evalFormProblem({ ...DEFAULT_EVAL_FORM, concurrency: 9 })).toMatch(
      /1 to 8/,
    );
  });

  it("becomes a create input named for the plugin and the moment, with each target's engine", () => {
    const input = pluginEvalInputOf(
      { id: "plg_1", org: "org_acme", name: "thermos" },
      {
        ...DEFAULT_EVAL_FORM,
        targets: [
          { harness: "native", modelName: "" },
          { harness: "cursor", modelName: "gpt-5" },
        ],
        compare: false,
        maxCostUsd: 2.5,
      },
      new Date(Date.UTC(2026, 9, 10, 5, 40, 12)),
    );
    expect(input).toEqual({
      name: "thermos evals 2026-10-10 05:40:12 UTC",
      org: "org_acme",
      pluginId: "plg_1",
      targets: [
        { harness: Harness.NATIVE },
        { harness: Harness.CURSOR, modelName: "gpt-5" },
      ],
      runs: 3,
      ablation: PluginEvalAblation.none,
      maxCostUsd: 2.5,
      concurrency: 1,
    });
    expect(
      pluginEvalInputOf(
        { id: "p", org: "o", name: "n" },
        DEFAULT_EVAL_FORM,
        new Date(0),
      ).ablation,
    ).toBe(PluginEvalAblation.with_without);
  });
});

describe("an eval's rows", () => {
  it("has a column per target and a row per case, each try summarised", () => {
    const pluginEval = evalWith(
      [{ name: "review-fires", score: 1, delta: 0.67 }],
      [SONNET, GPT],
    );
    expect(evalTargetLabelsOf(pluginEval)).toEqual([
      "native/claude-sonnet-4-6",
      "cursor/gpt-5",
    ]);
    const [row] = evalCaseRowsOf(pluginEval);
    expect(
      row?.cells.map((cell) => [
        cell.target,
        cell.withScore,
        cell.withoutScore,
        cell.delta,
        cell.passed,
      ]),
    ).toEqual([
      ["native/claude-sonnet-4-6", 1, 0.33, 0.67, true],
      ["cursor/gpt-5", 1, 0.33, 0.67, true],
    ]);
    expect(
      row?.cells[0]?.tries.map(
        (attempt) => `${attempt.arm} ${attempt.index}: ${attempt.summary}`,
      ),
    ).toEqual([
      "with 1: 1.00",
      "with 2: not graded: platform busy",
      "without 1: running",
    ]);
  });

  it("keeps a case that was not run out of the cells, with its reason", () => {
    const pluginEval = evalWith([{ name: "a", score: 1 }]);
    pluginEval.status!.cases.push({
      ...pluginEval.status!.cases[0]!,
      caseName: "fixture",
      notRunReason: "not run: context.add_dirs",
    });
    const rows = evalCaseRowsOf(pluginEval);
    expect(rows[1]).toMatchObject({
      name: "fixture",
      notRun: "not run: context.add_dirs",
      cells: [],
    });
  });

  it("is active while pending or running", () => {
    const pluginEval = evalWith([]);
    expect(isEvalActive(pluginEval)).toBe(false);
    pluginEval.status!.phase = PluginEvalPhase.running;
    expect(isEvalActive(pluginEval)).toBe(true);
    expect(isEvalActive(null)).toBe(false);
    expect(phaseLabel(PluginEvalPhase.partial)).toBe("Partial");
  });

  it("signs a difference", () => {
    expect(formatDelta(0.666)).toBe("+0.67");
    expect(formatDelta(-0.1)).toBe("-0.10");
    expect(formatDelta(-0.001)).toBe("0.00");
    expect(formatDelta(undefined)).toBe("—");
  });
});

describe("compareEvals", () => {
  it("lines two evals up case by case, flagging moved and one-sided cases", () => {
    const before = evalWith([
      { name: "same", score: 1, delta: 0.5 },
      { name: "moved", score: 0.5, delta: 0.1 },
      { name: "dropped", score: 1, delta: 0 },
    ]);
    const after = evalWith([
      { name: "same", score: 1, delta: 0.502 },
      { name: "moved", score: 1, delta: 0.6 },
      { name: "added", score: 0.33, delta: 0 },
    ]);
    const rows = compareEvals(before, after);
    expect(rows.map((row) => [row.name, row.changed])).toEqual([
      ["same", false],
      ["moved", true],
      ["added", true],
      ["dropped", true],
    ]);
    expect(rows[1]).toMatchObject({
      before: { score: 0.5, delta: 0.1 },
      after: { score: 1, delta: 0.6 },
    });
    expect(rows[2]?.before).toBeNull();
    expect(rows[3]?.after).toBeNull();
  });
});
