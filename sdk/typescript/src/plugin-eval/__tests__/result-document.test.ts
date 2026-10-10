// Pins the result document a plugin eval becomes: the fields Claude Code's
// format documents, under its names (schemaVersion 1, partial and
// partialReason, aggregates, cases[].name, cases[].aggregates.score and
// delta, cases[].arms.with[].error, costUsd, durationSeconds), and Stigmer's
// additions beside them (targets, passK, provisionalDelta, notRun). Also
// pins the departures: a try that was not graded scores null, never 0; a
// cancel reads as interrupted; out of credit is its own reason; with
// several targets the top-level cases are the first target's.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { pluginEvalTargetLabel, toResultDocument } from "../result-document.js";

const SONNET = { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" };
const GPT = { harness: Harness.CURSOR, modelName: "gpt-5" };

function graded(index: number, score: number, runId: string, error = "") {
  return { index, state: PluginEvalTryState.graded, score, runId, error };
}

function evalOf(overrides: {
  phase?: PluginEvalPhase;
  partialReason?: PluginEvalPartialReason;
  targets?: (typeof SONNET)[];
} = {}) {
  const targets = overrides.targets ?? [SONNET];
  return create(PluginEvalSchema, {
    metadata: { id: "pev_1", org: "acme" },
    spec: { pluginId: "plg_1", targets, maxCostUsd: 5 },
    status: {
      phase: overrides.phase ?? PluginEvalPhase.completed,
      partialReason: overrides.partialReason ?? PluginEvalPartialReason.unspecified,
      costUsd: 0.41,
      provisionalDelta: true,
      startedAt: timestampFromMs(1_000_000),
      finishedAt: timestampFromMs(1_074_000),
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67 },
      cases: [
        {
          caseName: "first-case",
          path: "evals/first-case",
          targets: targets.map((target, i) => ({
            target,
            withPlugin: {
              score: i === 0 ? 1 : 0.5,
              gradedTries: 2,
              tries: [
                graded(1, 1, "run_w1"),
                {
                  index: 2,
                  state: PluginEvalTryState.not_graded,
                  notGradedReason: "platform busy",
                  runId: "run_w2",
                },
              ],
            },
            withoutPlugin: {
              score: 0.33,
              gradedTries: 1,
              tries: [graded(1, 0.33, "run_o1", "timed out after 300s")],
            },
            delta: 0.67,
            passed: i === 0,
            passK: i === 0,
          })),
        },
        { caseName: "needs-fixture", path: "evals/needs-fixture", notRunReason: "not run: context.scaffold_script" },
      ],
    },
  });
}

describe("toResultDocument", () => {
  it("carries every field the format documents, under its names", () => {
    const doc = toResultDocument(evalOf());
    expect(doc).toMatchObject({
      schemaVersion: 1,
      partial: false,
      partialReason: null,
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67 },
      costUsd: 0.41,
      durationSeconds: 74,
    });
    expect(doc.cases).toHaveLength(1);
    const first = doc.cases[0]!;
    expect(first.name).toBe("first-case");
    expect(first.aggregates).toEqual({ score: 1, delta: 0.67 });
    expect(first.arms.with.map((run) => run.error)).toEqual([null, null]);
    expect(first.arms.without?.[0]?.error).toBe("timed out after 300s");
  });

  it("scores a try that was not graded as null with its reason, never 0", () => {
    const run = toResultDocument(evalOf()).cases[0]!.arms.with[1]!;
    expect(run).toEqual({ error: null, score: null, notGradedReason: "platform busy", runId: "run_w2" });
  });

  it("adds Stigmer's fields beside the format's: targets, passK, provisionalDelta, notRun", () => {
    const doc = toResultDocument(evalOf());
    expect(doc.provisionalDelta).toBe(true);
    expect(doc.evalId).toBe("pev_1");
    expect(doc.cases[0]!.passK).toBe(true);
    expect(doc.targets.map((target) => target.label)).toEqual(["native/claude-sonnet-4-6"]);
    expect(doc.notRun).toEqual([{ name: "needs-fixture", reason: "not run: context.scaffold_script" }]);
  });

  it("puts the first target's cases at the top level and every target's in targets", () => {
    const doc = toResultDocument(evalOf({ targets: [SONNET, GPT] }));
    expect(doc.targets.map((target) => [target.harness, target.model])).toEqual([
      ["native", "claude-sonnet-4-6"],
      ["cursor", "gpt-5"],
    ]);
    expect(doc.cases[0]!.aggregates.score).toBe(1);
    expect(doc.targets[1]!.cases[0]!.aggregates.score).toBe(0.5);
    expect(doc.targets[1]!.cases[0]!.passK).toBe(false);
  });

  it("names each partial reason: the ceiling, out of credit, and a cancel as interrupted", () => {
    const reason = (partialReason: PluginEvalPartialReason) =>
      toResultDocument(evalOf({ phase: PluginEvalPhase.partial, partialReason })).partialReason;
    expect(reason(PluginEvalPartialReason.cost_ceiling)).toBe("cost_ceiling");
    expect(reason(PluginEvalPartialReason.out_of_credit)).toBe("out_of_credit");
    expect(reason(PluginEvalPartialReason.cancelled)).toBe("interrupted");
    expect(toResultDocument(evalOf({ phase: PluginEvalPhase.partial, partialReason: PluginEvalPartialReason.cancelled })).partial).toBe(true);
  });

  it("reads a partial reason this client does not know as the phase says, never as a number", () => {
    const unknown = 99 as PluginEvalPartialReason;
    expect(toResultDocument(evalOf({ phase: PluginEvalPhase.partial, partialReason: unknown }))).toMatchObject({
      partial: true,
      partialReason: "interrupted",
    });
    expect(toResultDocument(evalOf({ phase: PluginEvalPhase.completed, partialReason: unknown }))).toMatchObject({
      partial: false,
      partialReason: null,
    });
  });

  it("is interrupted when the person stopped following it before the server recorded the cancel", () => {
    const doc = toResultDocument(evalOf({ phase: PluginEvalPhase.running }), { interrupted: true });
    expect(doc).toMatchObject({ partial: true, partialReason: "interrupted" });
  });

  it("omits delta, meanDelta and the without arm when the eval made no comparison", () => {
    const pluginEval = evalOf();
    const status = pluginEval.status!;
    status.aggregates!.meanDelta = undefined;
    const target = status.cases[0]!.targets[0]!;
    target.withoutPlugin = undefined;
    target.delta = undefined;
    const doc = toResultDocument(pluginEval);
    expect(doc.aggregates).not.toHaveProperty("meanDelta");
    expect(doc.cases[0]!.aggregates).not.toHaveProperty("delta");
    expect(doc.cases[0]!.arms).not.toHaveProperty("without");
  });

  it("lists a case that did not run on one target under notRun with that target, and leaves it out of that target's cases", () => {
    const pluginEval = evalOf({ targets: [SONNET, GPT] });
    pluginEval.status!.cases[0]!.targets[1]!.notRunReason = "not run: model 'gpt-5' needs a Cursor key";
    const doc = toResultDocument(pluginEval);
    expect(doc.targets[1]!.cases).toEqual([]);
    expect(doc.notRun).toContainEqual({
      name: "first-case",
      target: "cursor/gpt-5",
      reason: "not run: model 'gpt-5' needs a Cursor key",
    });
  });

  it("measures a running eval to the caller's clock, and reports the caller's duration when given", () => {
    const running = evalOf({ phase: PluginEvalPhase.running });
    running.status!.finishedAt = undefined;
    expect(toResultDocument(running, { nowMs: 1_010_000 }).durationSeconds).toBe(10);
    expect(toResultDocument(running, { durationSeconds: 3 }).durationSeconds).toBe(3);
  });

  it("reports no duration for an eval that has not started", () => {
    const pending = evalOf({ phase: PluginEvalPhase.pending });
    pending.status!.startedAt = undefined;
    pending.status!.finishedAt = undefined;
    expect(toResultDocument(pending, { nowMs: 9_000_000 }).durationSeconds).toBe(0);
  });

  it("reads the targets from the cases when the eval named none", () => {
    const pluginEval = evalOf();
    pluginEval.spec!.targets = [];
    expect(toResultDocument(pluginEval).targets.map((target) => target.label)).toEqual(["native/claude-sonnet-4-6"]);
  });
});

describe("pluginEvalTargetLabel", () => {
  it("writes harness/model, the native engine for an unspecified one, default for no model", () => {
    expect(pluginEvalTargetLabel({ harness: Harness.CURSOR, modelName: "gpt-5" } as never)).toBe("cursor/gpt-5");
    expect(pluginEvalTargetLabel(undefined)).toBe("native/default");
  });

  it("names an engine this client does not know by its number", () => {
    expect(pluginEvalTargetLabel({ harness: 9 as Harness, modelName: "m" } as never)).toBe("9/m");
  });
});
