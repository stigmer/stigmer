/**
 * Pins the Evals tab's pure rules on an eval run about a plugin: the
 * form's limits and the create input its settings become (unnamed, so the
 * server names it by its id; the targets' engines, the comparison as the
 * ablation), an eval run's label (its plugin and when it started), its
 * plugin's cases read as one row per case with a cell per target and each
 * try summarised (a try the platform could not grade shows why, never 0),
 * the phase words (a phase or try state this client does not know reads
 * in words with its number), and two eval runs compared case by case with
 * moved and one-sided cases flagged, moved meaning the cells read
 * differently to two decimals. Also the pieces every subject shares: the
 * targets the run settings send, the allowed tools as typed and as the
 * API's pattern judges them, and a case list read and compared alone.
 * eval-view.agent.test.ts pins the rules of an eval run about an agent.
 */
import { describe, expect, it } from "vitest";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  EvalRunMockedServerSchema,
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTrySchema,
  EvalRunTryState,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  DEFAULT_EVAL_FORM,
  MAX_ALLOW_TOOLS,
  allowToolsProblem,
  caseSourceRowsOf,
  caseSourceTargetLabelsOf,
  compareCaseSources,
  comparedPluginOf,
  evalCaseSourceOf,
  evalTargetsOf,
  parseAllowTools,
  partialLabel,
  compareEvalRuns,
  evalFormProblem,
  evalRunInputOf,
  evalRunLabelOf,
  evalRunSectionsOf,
  formatDelta,
  isEvalActive,
  phaseLabel,
  type EvalCaseRow,
  type EvalCompareRow,
  type EvalFormSettings,
} from "../eval-view";
import { GPT, SONNET, evalStartOf, evalWith } from "./eval-fixture";

/** The plugin's cases of an eval run about a plugin. */
function casesOf(evalRun: EvalRun) {
  return evalRun.status!.plugins[0]!.cases;
}

/** The plugin's block of an eval run about a plugin, as the table reads it. */
function sourceOf(evalRun: EvalRun) {
  return evalCaseSourceOf(evalRun, evalRun.status!.plugins[0]!);
}

/** The plugin's rows. */
function rowsOf(evalRun: EvalRun): readonly EvalCaseRow[] {
  return caseSourceRowsOf(sourceOf(evalRun));
}

/** The plugin's target columns. */
function labelsOf(evalRun: EvalRun): readonly string[] {
  return caseSourceTargetLabelsOf(sourceOf(evalRun));
}

/** The plugin's cases in two eval runs, compared. */
function compareRows(before: EvalRun, after: EvalRun): readonly EvalCompareRow[] {
  return compareEvalRuns(before, after)[0]?.rows ?? [];
}

/** The form's problem on a plugin. */
function problemOf(settings: EvalFormSettings): string | null {
  return evalFormProblem(settings, "plugin");
}

/** The create input on the plugin `id` in `org`. */
function inputOf(plugin: { id: string; org: string }, settings: EvalFormSettings) {
  return evalRunInputOf({ kind: "plugin", ...plugin }, settings);
}

describe("the Run evals form", () => {
  it("starts from each case's own model and runs, compared, $5, one at a time", () => {
    expect(DEFAULT_EVAL_FORM).toEqual({
      caseModels: true,
      targets: [{ harness: "native", modelName: "" }],
      runs: 0,
      compare: true,
      maxCostUsd: 5,
      concurrency: 1,
      comparedPluginId: "",
      caseSources: [],
      evalSources: [],
      caseGlob: "",
      caseTags: [],
      allowTools: [],
    });
    expect(problemOf(DEFAULT_EVAL_FORM)).toBeNull();
  });

  it("refuses settings the API refuses, in a sentence", () => {
    const picked = { ...DEFAULT_EVAL_FORM, caseModels: false };
    expect(problemOf({ ...picked, targets: [] })).toMatch(
      /one to 6 models/,
    );
    expect(problemOf({ ...DEFAULT_EVAL_FORM, runs: 51 })).toMatch(
      /1 to 50/,
    );
    expect(problemOf({ ...DEFAULT_EVAL_FORM, runs: 1.5 })).toMatch(
      /whole number/,
    );
    expect(problemOf({ ...DEFAULT_EVAL_FORM, maxCostUsd: 0 })).toMatch(
      /more than \$0/,
    );
    expect(problemOf({ ...DEFAULT_EVAL_FORM, maxCostUsd: 1001 })).toMatch(
      /at most \$1000/,
    );
    expect(
      problemOf({ ...DEFAULT_EVAL_FORM, maxCostUsd: Number.NaN }),
    ).not.toBeNull();
    expect(problemOf({ ...DEFAULT_EVAL_FORM, concurrency: 9 })).toMatch(
      /1 to 8/,
    );
  });

  it("takes no models and no tries to mean each case's own", () => {
    expect(
      problemOf({ ...DEFAULT_EVAL_FORM, targets: [], runs: 0 }),
    ).toBeNull();
    const input = inputOf(
      { id: "plg_1", org: "org_acme" },
      DEFAULT_EVAL_FORM,
    );
    expect(input.targets).toEqual([]);
    expect(input.runs).toBe(0);
  });

  it("becomes an unnamed create input, with each target's engine", () => {
    const input = inputOf(
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
      ablation: EvalRunAblation.none,
      maxCostUsd: 2.5,
      concurrency: 1,
      caseGlob: "",
      caseTags: [],
      allowTools: [],
    });
    expect(
      inputOf({ id: "p", org: "o" }, DEFAULT_EVAL_FORM).ablation,
    ).toBe(EvalRunAblation.with_without);
  });
});

describe("an eval run's label", () => {
  it("is its plugin and when it started, never its name", () => {
    const evalRun = evalWith([], undefined, "evr_7");
    const at = (date: Date) => date.toISOString();
    expect(evalRunLabelOf(evalRun, "thermos", at)).toBe(
      `thermos · started ${evalStartOf("evr_7").toISOString()}`,
    );
    expect(evalRunLabelOf(evalRun, " ", at)).toBe(
      `Eval run · started ${evalStartOf("evr_7").toISOString()}`,
    );
    expect(evalRunLabelOf(evalRun, "thermos")).toBe(
      `thermos · started ${evalStartOf("evr_7").toLocaleString()}`,
    );
  });

  it("falls back to the id when the eval carries no start", () => {
    const evalRun = evalWith([], undefined, "evr_7");
    evalRun.status!.audit = undefined;
    expect(evalRunLabelOf(evalRun, "thermos")).toBe("thermos · evr_7");
  });
});

describe("an eval run's rows", () => {
  it("has a column per target and a row per case, each try summarised", () => {
    const evalRun = evalWith(
      [{ name: "review-fires", score: 1, delta: 0.67 }],
      [SONNET, GPT],
    );
    expect(labelsOf(evalRun)).toEqual([
      "native/claude-sonnet-4-6",
      "cursor/gpt-5",
    ]);
    const [row] = rowsOf(evalRun);
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

  it("names a try's abort or error beside its score, and lists the case's MCP servers as its tries saw them", () => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    const evalCase = casesOf(evalRun)[0]!;
    evalCase.mockedServers = [
      create(EvalRunMockedServerSchema, { name: "plugin_kit_tracker", tools: ["create_issue", "close_issue"] }),
      create(EvalRunMockedServerSchema, { name: "plugin_kit_wiki", notStartedReason: "not started: no mock" }),
    ];
    const tries = evalCase.targets[0]!.withPlugin!.tries;
    tries[0] = create(EvalRunTrySchema, {
      index: 1,
      state: EvalRunTryState.graded,
      score: 0,
      aborted: { server: "tracker", tool: "create_issue", reason: "input.title must be a string" },
    });
    tries[1] = create(EvalRunTrySchema, {
      index: 2,
      state: EvalRunTryState.graded,
      score: 0,
      error: "scaffold failed: exit 2",
    });
    const row = rowsOf(evalRun)[0];
    expect(row?.mocked).toEqual([
      "plugin_kit_tracker mocked: create_issue, close_issue",
      "plugin_kit_wiki not started: no mock",
    ]);
    expect(row?.cells[0]?.tries.slice(0, 2).map((attempt) => attempt.summary)).toEqual([
      "0.00 · aborted by tracker.create_issue: input.title must be a string",
      "0.00 · scaffold failed: exit 2",
    ]);
  });

  it("keeps a case that was not run out of the cells, with its reason", () => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    casesOf(evalRun).push({
      ...casesOf(evalRun)[0]!,
      caseName: "fixture",
      notRunReason: "not run: plugins",
    });
    const rows = rowsOf(evalRun);
    expect(rows[1]).toMatchObject({
      name: "fixture",
      notRun: "not run: plugins",
      cells: [],
    });
  });

  it("summarises a try a finished eval never ran, one not graded without a reason, and a state this client does not know", () => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    const tries = casesOf(evalRun)[0]!.targets[0]!.withPlugin!.tries;
    tries[0]!.state = EvalRunTryState.pending;
    tries[1]!.notGradedReason = "";
    tries.push(
      { ...tries[0]!, index: 3, state: EvalRunTryState.unspecified },
      { ...tries[0]!, index: 4, state: 7 as EvalRunTryState },
    );
    expect(
      rowsOf(evalRun)[0]
        ?.cells[0]?.tries.filter((attempt) => attempt.arm === "with")
        .map((attempt) => attempt.summary),
    ).toEqual(["not run", "not graded", "not run", "unknown state 7"]);
  });

  it("summarises a try not finished by the eval's phase: waiting while it starts, waiting or running while it runs, in words for a phase this client does not know", () => {
    const summaries = (phase: EvalRunPhase): string[] => {
      const evalRun = evalWith([{ name: "a", score: 1 }]);
      evalRun.status!.phase = phase;
      const tries = casesOf(evalRun)[0]!.targets[0]!.withPlugin!.tries;
      tries[0]!.state = EvalRunTryState.pending;
      tries[1]!.state = EvalRunTryState.unspecified;
      return (
        rowsOf(evalRun)[0]
          ?.cells[0]?.tries.filter((attempt) => attempt.arm === "with")
          .map((attempt) => attempt.summary) ?? []
      );
    };
    expect(summaries(EvalRunPhase.pending)).toEqual(["waiting", "waiting"]);
    expect(summaries(EvalRunPhase.running)).toEqual([
      "waiting or running",
      "waiting or running",
    ]);
    expect(summaries(EvalRunPhase.partial)).toEqual(["not run", "not run"]);
    expect(summaries(9 as EvalRunPhase)).toEqual([
      "not finished (phase 9)",
      "not finished (phase 9)",
    ]);
  });

  it("leaves out the cell of a target the case has no result on", () => {
    const evalRun = evalWith([{ name: "a", score: 1 }], [SONNET, GPT]);
    casesOf(evalRun)[0]!.targets.pop();
    expect(labelsOf(evalRun)).toEqual([
      "native/claude-sonnet-4-6",
      "cursor/gpt-5",
    ]);
    expect(
      rowsOf(evalRun)[0]?.cells.map((cell) => cell.target),
    ).toEqual(["native/claude-sonnet-4-6"]);
  });

  it("names every phase, and one this client does not know in words with its number", () => {
    expect(
      [
        EvalRunPhase.pending,
        EvalRunPhase.running,
        EvalRunPhase.completed,
        EvalRunPhase.partial,
        EvalRunPhase.failed,
        EvalRunPhase.unspecified,
        42 as EvalRunPhase,
      ].map(phaseLabel),
    ).toEqual(["Starting", "Running", "Completed", "Partial", "Failed", "", "unknown phase 42"]);
  });

  it("is active while pending or running", () => {
    const evalRun = evalWith([]);
    expect(isEvalActive(evalRun)).toBe(false);
    evalRun.status!.phase = EvalRunPhase.running;
    expect(isEvalActive(evalRun)).toBe(true);
    expect(isEvalActive(null)).toBe(false);
    expect(phaseLabel(EvalRunPhase.partial)).toBe("Partial");
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
    const rows = compareRows(before, after);
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
      compareRows(evalWith([{ name: "a", score: a, delta: a }]), evalWith([{ name: "a", score: b, delta: b }]))[0]?.changed;
    expect(changed(0.4951, 0.5049), "both read 0.50").toBe(false);
    expect(changed(0.494, 0.496), "0.49 against 0.50").toBe(true);
    const deltas = compareRows(evalWith([{ name: "a", score: 1, delta: -0.004 }]), evalWith([{ name: "a", score: 1, delta: 0.004 }]));
    expect(deltas[0]?.changed, "both differences read 0.00").toBe(false);
  });

  it("treats a case not run on a target as absent from that eval there", () => {
    const before = evalWith([{ name: "a", score: 1, delta: 0.5 }]);
    const after = evalWith([{ name: "a", score: 1, delta: 0.5 }]);
    casesOf(after)[0]!.targets[0]!.notRunReason =
      "not run: model 'claude-sonnet-4-6' is not available";
    expect(compareRows(before, after)).toEqual([
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
    expect(compareRows(scored, unscored)[0]).toMatchObject({
      before: { score: 1 },
      after: { score: undefined },
      changed: true,
    });
    expect(compareRows(unscored, evalWith([{ name: "a" }]))[0]?.changed).toBe(
      false,
    );
  });
});

describe("the pieces every subject shares", () => {
  it("sends no targets while no models are picked, and each picked model's engine otherwise", () => {
    expect(evalTargetsOf(DEFAULT_EVAL_FORM)).toEqual([]);
    expect(
      evalTargetsOf({
        ...DEFAULT_EVAL_FORM,
        caseModels: false,
        targets: [
          { harness: "native", modelName: "" },
          { harness: "cursor", modelName: "gpt-5" },
        ],
      }),
    ).toEqual([
      { harness: Harness.NATIVE },
      { harness: Harness.CURSOR, modelName: "gpt-5" },
    ]);
  });

  it("reads allowed tools one per line or comma-separated, keeping a comma inside a specifier", () => {
    expect(
      parseAllowTools("Skill, Agent\nBash(git log, *)\n\n  mcp__github__* "),
    ).toEqual(["Skill", "Agent", "Bash(git log, *)", "mcp__github__*"]);
    expect(parseAllowTools("  ")).toEqual([]);
  });

  it("judges allowed tools by the API's pattern, naming the first it would refuse", () => {
    expect(
      allowToolsProblem([
        "Skill",
        "Agent",
        "Bash(npm test *)",
        "mcp__*",
        "mcp__github__*",
        "mcp__plugin_thermos_github__create_issue",
      ]),
    ).toBeNull();
    expect(allowToolsProblem(["Skill", "bash"])).toMatch(
      /^'bash' is not a tool name/,
    );
    expect(allowToolsProblem(["mcp__plugin__github__*"])).toMatch(
      /is not a tool name/,
    );
    expect(
      allowToolsProblem(Array.from({ length: MAX_ALLOW_TOOLS + 1 }, () => "Skill")),
    ).toMatch(/at most 64 tools/);
  });

  it("reads and compares a case list alone exactly as the eval run's sections do", () => {
    const before = evalWith([{ name: "a", score: 1 }], [SONNET, GPT], "evr_1");
    const after = evalWith([{ name: "a", score: 0.5 }], [SONNET, GPT], "evr_2");
    const [section] = evalRunSectionsOf(before);
    expect(section?.rows).toEqual(rowsOf(before));
    expect(section?.labels).toEqual(labelsOf(before));
    expect(section).toMatchObject({ slug: "thermos", compared: true, attached: false });
    expect(comparedPluginOf(before), "an eval run about a plugin compares no plugin of an agent").toBeUndefined();
    expect(compareCaseSources(sourceOf(before), sourceOf(after))).toEqual(
      compareRows(before, after),
    );
  });

  it("names why an eval stopped early, and a reason this client does not know as stopped early", () => {
    expect(partialLabel(EvalRunPartialReason.cost_ceiling)).toBe("cost limit reached");
    expect(partialLabel(EvalRunPartialReason.unspecified)).toBe("");
    expect(partialLabel(99 as EvalRunPartialReason)).toBe("stopped early");
  });
});
