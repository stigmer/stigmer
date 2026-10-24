// Pins the result document an eval run about a plugin becomes: its one
// plugin's block carries the fields Claude Code's format documents, under
// its names (schemaVersion 1, partial and partialReason, aggregates,
// cases[].name, cases[].aggregates.score and delta,
// cases[].arms.with[].error and aborted, costUsd, durationSeconds), and
// Stigmer's additions beside them (the plugin, targets, passK, notRun); the
// document names its subject and totals. Also pins the departures: a try
// that was not graded scores null, never 0; a cancel reads as interrupted;
// with several targets a block's top-level cases are the first target's.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTrySchema,
  EvalRunTryState,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { evalRunTargetLabel, toResultDocument } from "../result-document.js";
import type { ResultDocumentOptions } from "../result-document.js";

const SONNET = { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" };
const GPT = { harness: Harness.CURSOR, modelName: "gpt-5" };

function graded(index: number, score: number, runId: string, error = "") {
  return { index, state: EvalRunTryState.graded, score, runId, error };
}

function evalOf(overrides: {
  phase?: EvalRunPhase;
  partialReason?: EvalRunPartialReason;
  targets?: (typeof SONNET)[];
} = {}) {
  const targets = overrides.targets ?? [SONNET];
  return create(EvalRunSchema, {
    metadata: { id: "evr_1", org: "acme" },
    spec: { subject: { case: "pluginId", value: "plg_1" }, targets, maxCostUsd: 5 },
    status: {
      phase: overrides.phase ?? EvalRunPhase.completed,
      partialReason: overrides.partialReason ?? EvalRunPartialReason.unspecified,
      costUsd: 0.41,
      startedAt: timestampFromMs(1_000_000),
      finishedAt: timestampFromMs(1_074_000),
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67 },
      plugins: [
        {
          pluginId: "plg_1",
          pluginSlug: "thermos",
          pluginDigest: "d".repeat(64),
          compared: true,
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
                  state: EvalRunTryState.not_graded,
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
        { caseName: "needs-fixture", path: "evals/needs-fixture", notRunReason: "not run: plugins" },
          ],
        },
      ],
    },
  });
}

/** The document's one block: the plugin's. */
function block(evalRun: ReturnType<typeof evalOf>, opts?: ResultDocumentOptions) {
  return toResultDocument(evalRun, opts).plugins[0]!;
}

describe("toResultDocument", () => {
  it("names the plugin as its subject, with its totals, and one block for the plugin", () => {
    const doc = toResultDocument(evalOf());
    expect(doc).toMatchObject({
      schemaVersion: 1,
      evalRunId: "evr_1",
      subject: { kind: "plugin", id: "plg_1", slug: "thermos" },
      partial: false,
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67 },
      costUsd: 0.41,
      durationSeconds: 74,
    });
    expect(doc.plugins.map((entry) => entry.plugin)).toEqual([
      { id: "plg_1", slug: "thermos", digest: "d".repeat(64), attached: false, compared: true },
    ]);
  });

  it("carries every field the format documents, under its names", () => {
    const doc = block(evalOf());
    expect(doc).toMatchObject({
      schemaVersion: 1,
      partial: false,
      partialReason: null,
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67 },
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
    const run = block(evalOf()).cases[0]!.arms.with[1]!;
    expect(run).toEqual({ error: null, score: null, notGradedReason: "platform busy", runId: "run_w2" });
  });

  it("writes a mock's abort on its run as the format does: a 0, no error, and the mock named", () => {
    const evalRun = evalOf();
    const withArm = evalRun.status!.plugins[0]!.cases[0]!.targets[0]!.withPlugin!;
    withArm.tries[0] = create(EvalRunTrySchema, {
      index: 1,
      state: EvalRunTryState.graded,
      score: 0,
      runId: "run_w1",
      aborted: { server: "tracker", tool: "create_issue", reason: "input.title must be a string" },
    });
    expect(block(evalRun).cases[0]!.arms.with[0]).toEqual({
      error: null,
      score: 0,
      notGradedReason: null,
      runId: "run_w1",
      aborted: { server: "tracker", tool: "create_issue", reason: "input.title must be a string" },
    });
  });

  it("adds Stigmer's fields beside the format's: targets, passK, notRun", () => {
    const doc = block(evalOf());
    expect(doc.cases[0]!.passK).toBe(true);
    expect(doc.targets.map((target) => target.label)).toEqual(["native/claude-sonnet-4-6"]);
    expect(doc.notRun).toEqual([{ name: "needs-fixture", reason: "not run: plugins" }]);
  });

  it("puts the first target's cases at the top level and every target's in targets", () => {
    const doc = block(evalOf({ targets: [SONNET, GPT] }));
    expect(doc.targets.map((target) => [target.harness, target.model])).toEqual([
      ["native", "claude-sonnet-4-6"],
      ["cursor", "gpt-5"],
    ]);
    expect(doc.cases[0]!.aggregates.score).toBe(1);
    expect(doc.targets[1]!.cases[0]!.aggregates.score).toBe(0.5);
    expect(doc.targets[1]!.cases[0]!.passK).toBe(false);
  });

  it("names each partial reason: the ceiling, and a cancel as interrupted", () => {
    const reason = (partialReason: EvalRunPartialReason) =>
      block(evalOf({ phase: EvalRunPhase.partial, partialReason })).partialReason;
    expect(reason(EvalRunPartialReason.cost_ceiling)).toBe("cost_ceiling");
    expect(reason(EvalRunPartialReason.cancelled)).toBe("interrupted");
    expect(block(evalOf({ phase: EvalRunPhase.partial, partialReason: EvalRunPartialReason.cancelled })).partial).toBe(true);
  });

  it("reads a partial reason this client does not know as the phase says, never as a number", () => {
    const unknown = 99 as EvalRunPartialReason;
    expect(block(evalOf({ phase: EvalRunPhase.partial, partialReason: unknown }))).toMatchObject({
      partial: true,
      partialReason: "interrupted",
    });
    expect(block(evalOf({ phase: EvalRunPhase.completed, partialReason: unknown }))).toMatchObject({
      partial: false,
      partialReason: null,
    });
  });

  it("is interrupted when the person stopped following it before the server recorded the cancel", () => {
    const doc = block(evalOf({ phase: EvalRunPhase.running }), { interrupted: true });
    expect(doc).toMatchObject({ partial: true, partialReason: "interrupted" });
  });

  it("omits delta, meanDelta and the without arm when the eval made no comparison", () => {
    const evalRun = evalOf();
    const status = evalRun.status!;
    status.plugins[0]!.aggregates!.meanDelta = undefined;
    const target = status.plugins[0]!.cases[0]!.targets[0]!;
    target.withoutPlugin = undefined;
    target.delta = undefined;
    const doc = block(evalRun);
    expect(doc.aggregates).not.toHaveProperty("meanDelta");
    expect(doc.cases[0]!.aggregates).not.toHaveProperty("delta");
    expect(doc.cases[0]!.arms).not.toHaveProperty("without");
  });

  it("lists a case that did not run on one target under notRun with that target, and leaves it out of that target's cases", () => {
    const evalRun = evalOf({ targets: [SONNET, GPT] });
    evalRun.status!.plugins[0]!.cases[0]!.targets[1]!.notRunReason = "not run: model 'gpt-5' needs a Cursor key";
    const doc = block(evalRun);
    expect(doc.targets[1]!.cases).toEqual([]);
    expect(doc.notRun).toContainEqual({
      name: "first-case",
      target: "cursor/gpt-5",
      reason: "not run: model 'gpt-5' needs a Cursor key",
    });
  });

  it("measures a running eval to the caller's clock, and reports the caller's duration when given", () => {
    const running = evalOf({ phase: EvalRunPhase.running });
    running.status!.finishedAt = undefined;
    expect(block(running, { nowMs: 1_010_000 }).durationSeconds).toBe(10);
    expect(block(running, { durationSeconds: 3 }).durationSeconds).toBe(3);
  });

  it("reports no duration for an eval that has not started", () => {
    const pending = evalOf({ phase: EvalRunPhase.pending });
    pending.status!.startedAt = undefined;
    pending.status!.finishedAt = undefined;
    expect(block(pending, { nowMs: 9_000_000 }).durationSeconds).toBe(0);
  });

  it("reads the targets from the cases when the eval named none", () => {
    const evalRun = evalOf();
    evalRun.spec!.targets = [];
    expect(block(evalRun).targets.map((target) => target.label)).toEqual(["native/claude-sonnet-4-6"]);
  });
});

describe("evalRunTargetLabel", () => {
  it("writes harness/model, the native engine for an unspecified one, default for no model", () => {
    expect(evalRunTargetLabel({ harness: Harness.CURSOR, modelName: "gpt-5" } as never)).toBe("cursor/gpt-5");
    expect(evalRunTargetLabel({ harness: Harness.CLAUDE, modelName: "" } as never)).toBe("claude/default");
    expect(evalRunTargetLabel(undefined)).toBe("native/default");
  });

  it("names an engine this client does not know by its number", () => {
    expect(evalRunTargetLabel({ harness: 9 as Harness, modelName: "m" } as never)).toBe("9/m");
  });
});
