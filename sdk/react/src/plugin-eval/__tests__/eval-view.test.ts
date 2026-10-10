/**
 * Pins the Evals tab's pure rules: the form's limits and the create input
 * its settings become (unnamed, so the server names it by its id; the
 * targets' engines, the comparison as the ablation), an eval's label (its
 * plugin and when it started), an eval read as one row per case with a
 * cell per target and each try summarised (a try the platform could not
 * grade shows why, never 0), the phase words (a phase or try state this
 * client does not know reads in words with its number), and two evals
 * compared case by case with moved and one-sided cases flagged, moved
 * meaning the cells read differently to two decimals.
 */
import { describe, expect, it } from "vitest";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  DEFAULT_EVAL_FORM,
  compareEvals,
  evalCaseRowsOf,
  evalFormProblem,
  evalLabelOf,
  evalTargetLabelsOf,
  formatDelta,
  isEvalActive,
  phaseLabel,
  pluginEvalInputOf,
} from "../eval-view";
import { GPT, SONNET, evalStartOf, evalWith } from "./eval-fixture";

describe("the Run evals form", () => {
  it("starts from each case's own model and runs, compared, $5, one at a time", () => {
    expect(DEFAULT_EVAL_FORM).toEqual({
      caseModels: true,
      targets: [{ harness: "native", modelName: "" }],
      runs: 0,
      compare: true,
      maxCostUsd: 5,
      concurrency: 1,
    });
    expect(evalFormProblem(DEFAULT_EVAL_FORM)).toBeNull();
  });

  it("refuses settings the API refuses, in a sentence", () => {
    const picked = { ...DEFAULT_EVAL_FORM, caseModels: false };
    expect(evalFormProblem({ ...picked, targets: [] })).toMatch(
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

  it("takes no models and no tries to mean each case's own", () => {
    expect(
      evalFormProblem({ ...DEFAULT_EVAL_FORM, targets: [], runs: 0 }),
    ).toBeNull();
    const input = pluginEvalInputOf(
      { id: "plg_1", org: "org_acme" },
      DEFAULT_EVAL_FORM,
    );
    expect(input.targets).toEqual([]);
    expect(input.runs).toBe(0);
  });

  it("becomes an unnamed create input, with each target's engine", () => {
    const input = pluginEvalInputOf(
      { id: "plg_1", org: "org_acme" },
      {
        ...DEFAULT_EVAL_FORM,
        caseModels: false,
        runs: 3,
        targets: [
          { harness: "native", modelName: "" },
          { harness: "cursor", modelName: "gpt-5" },
        ],
        compare: false,
        maxCostUsd: 2.5,
      },
    );
    expect(input).toEqual({
      name: "",
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
      pluginEvalInputOf({ id: "p", org: "o" }, DEFAULT_EVAL_FORM).ablation,
    ).toBe(PluginEvalAblation.with_without);
  });
});

describe("an eval's label", () => {
  it("is its plugin and when it started, never its name", () => {
    const pluginEval = evalWith([], undefined, "pev_7");
    const at = (date: Date) => date.toISOString();
    expect(evalLabelOf(pluginEval, "thermos", at)).toBe(
      `thermos · started ${evalStartOf("pev_7").toISOString()}`,
    );
    expect(evalLabelOf(pluginEval, " ", at)).toBe(
      `Eval · started ${evalStartOf("pev_7").toISOString()}`,
    );
    expect(evalLabelOf(pluginEval, "thermos")).toBe(
      `thermos · started ${evalStartOf("pev_7").toLocaleString()}`,
    );
  });

  it("falls back to the id when the eval carries no start", () => {
    const pluginEval = evalWith([], undefined, "pev_7");
    pluginEval.status!.audit = undefined;
    expect(evalLabelOf(pluginEval, "thermos")).toBe("thermos · pev_7");
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

  it("summarises a try a finished eval never ran, one not graded without a reason, and a state this client does not know", () => {
    const pluginEval = evalWith([{ name: "a", score: 1 }]);
    const tries = pluginEval.status!.cases[0]!.targets[0]!.withPlugin!.tries;
    tries[0]!.state = PluginEvalTryState.pending;
    tries[1]!.notGradedReason = "";
    tries.push(
      { ...tries[0]!, index: 3, state: PluginEvalTryState.unspecified },
      { ...tries[0]!, index: 4, state: 7 as PluginEvalTryState },
    );
    expect(
      evalCaseRowsOf(pluginEval)[0]
        ?.cells[0]?.tries.filter((attempt) => attempt.arm === "with")
        .map((attempt) => attempt.summary),
    ).toEqual(["not run", "not graded", "not run", "unknown state 7"]);
  });

  it("summarises a try not finished by the eval's phase: waiting while it starts, waiting or running while it runs, in words for a phase this client does not know", () => {
    const summaries = (phase: PluginEvalPhase): string[] => {
      const pluginEval = evalWith([{ name: "a", score: 1 }]);
      pluginEval.status!.phase = phase;
      const tries = pluginEval.status!.cases[0]!.targets[0]!.withPlugin!.tries;
      tries[0]!.state = PluginEvalTryState.pending;
      tries[1]!.state = PluginEvalTryState.unspecified;
      return (
        evalCaseRowsOf(pluginEval)[0]
          ?.cells[0]?.tries.filter((attempt) => attempt.arm === "with")
          .map((attempt) => attempt.summary) ?? []
      );
    };
    expect(summaries(PluginEvalPhase.pending)).toEqual(["waiting", "waiting"]);
    expect(summaries(PluginEvalPhase.running)).toEqual([
      "waiting or running",
      "waiting or running",
    ]);
    expect(summaries(PluginEvalPhase.partial)).toEqual(["not run", "not run"]);
    expect(summaries(9 as PluginEvalPhase)).toEqual([
      "not finished (phase 9)",
      "not finished (phase 9)",
    ]);
  });

  it("leaves out the cell of a target the case has no result on", () => {
    const pluginEval = evalWith([{ name: "a", score: 1 }], [SONNET, GPT]);
    pluginEval.status!.cases[0]!.targets.pop();
    expect(evalTargetLabelsOf(pluginEval)).toEqual([
      "native/claude-sonnet-4-6",
      "cursor/gpt-5",
    ]);
    expect(
      evalCaseRowsOf(pluginEval)[0]?.cells.map((cell) => cell.target),
    ).toEqual(["native/claude-sonnet-4-6"]);
  });

  it("names every phase, and one this client does not know in words with its number", () => {
    expect(
      [
        PluginEvalPhase.pending,
        PluginEvalPhase.running,
        PluginEvalPhase.completed,
        PluginEvalPhase.partial,
        PluginEvalPhase.failed,
        PluginEvalPhase.unspecified,
        42 as PluginEvalPhase,
      ].map(phaseLabel),
    ).toEqual(["Starting", "Running", "Completed", "Partial", "Failed", "", "unknown phase 42"]);
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

  it("calls a case changed exactly when its cells, to two decimals, read differently", () => {
    const changed = (a: number, b: number): boolean | undefined =>
      compareEvals(evalWith([{ name: "a", score: a, delta: a }]), evalWith([{ name: "a", score: b, delta: b }]))[0]?.changed;
    expect(changed(0.4951, 0.5049), "both read 0.50").toBe(false);
    expect(changed(0.494, 0.496), "0.49 against 0.50").toBe(true);
    const deltas = compareEvals(evalWith([{ name: "a", score: 1, delta: -0.004 }]), evalWith([{ name: "a", score: 1, delta: 0.004 }]));
    expect(deltas[0]?.changed, "both differences read 0.00").toBe(false);
  });

  it("treats a case not run on a target as absent from that eval there", () => {
    const before = evalWith([{ name: "a", score: 1, delta: 0.5 }]);
    const after = evalWith([{ name: "a", score: 1, delta: 0.5 }]);
    after.status!.cases[0]!.targets[0]!.notRunReason =
      "not run: model 'claude-sonnet-4-6' is not available";
    expect(compareEvals(before, after)).toEqual([
      {
        name: "a",
        target: "native/claude-sonnet-4-6",
        before: { score: 1, delta: 0.5 },
        after: null,
        changed: true,
      },
    ]);
  });

  it("flags a score present on one side only, and not one missing on both", () => {
    const scored = evalWith([{ name: "a", score: 1 }]);
    const unscored = evalWith([{ name: "a" }]);
    expect(compareEvals(scored, unscored)[0]).toMatchObject({
      before: { score: 1 },
      after: { score: undefined },
      changed: true,
    });
    expect(compareEvals(unscored, evalWith([{ name: "a" }]))[0]?.changed).toBe(
      false,
    );
  });
});
