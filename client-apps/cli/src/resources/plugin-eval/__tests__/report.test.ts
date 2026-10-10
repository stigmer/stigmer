// Pins what `plugin eval` prints and its exit code: a progress line per
// finished try (case, target, arm, try, score or not-graded reason, and the
// run's error); the format's table, one block per target, with Stigmer's
// PASS^k column (no block for a target nothing ran on), and SCORE PASS%
// when the eval made no comparison; the summary line with "Δ provisional";
// the not-run cases with the feature named; why a partial eval stopped; and
// the exit codes 0, 1, 2 and 130.

import { create } from "@bufbuild/protobuf";
import { PluginEvalAblation, PluginEvalTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPartialReason, PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import {
  EvalExit,
  evalExitCode,
  finishedTries,
  isSettled,
  partialLine,
  renderEvalTables,
  renderNotRun,
  renderSummaryLine,
} from "../report.js";
import { finishedEval } from "./fixtures.js";

describe("finishedTries", () => {
  it("prints each finished try once, with its score, its not-graded reason or its error, and skips running tries", () => {
    const tries = finishedTries(finishedEval());
    expect(tries.map((attempt) => attempt.line)).toEqual([
      "first-case · native/claude-sonnet-4-6 · with · try 1/2 · 1.00",
      "first-case · native/claude-sonnet-4-6 · with · try 2/2 · not graded: platform busy",
      "first-case · native/claude-sonnet-4-6 · without · try 1/2 · 0.33 (timed out after 300s)",
    ]);
    expect(new Set(tries.map((attempt) => attempt.key)).size).toBe(3);
  });
});

describe("renderEvalTables", () => {
  it("prints the format's columns with PASS^k under a heading for the target, leaving out cases not run", () => {
    const out = renderEvalTables(finishedEval());
    const lines = out.split("\n");
    expect(lines[0]).toBe("native/claude-sonnet-4-6");
    expect(lines[1]).toMatch(/^CASE\s+WITH\s+W\/OUT\s+Δ\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[3]).toMatch(/^first-case\s+1\.00\s+0\.33\s+\+0\.67\s+yes\s+4\s+\$0\.41\s+not graded: platform busy$/);
    expect(out).not.toContain("needs-fixture");
  });

  it("shows SCORE and PASS% when the eval made no comparison", () => {
    const pluginEval = finishedEval();
    pluginEval.spec!.ablation = PluginEvalAblation.none;
    const target = pluginEval.status!.cases[0]!.targets[0]!;
    target.withoutPlugin = undefined;
    target.delta = undefined;
    const lines = renderEvalTables(pluginEval).split("\n");
    expect(lines[1]).toMatch(/^CASE\s+SCORE\s+PASS%\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[3]).toMatch(/^first-case\s+1\.00\s+100%\s+yes\s+2\s+\$0\.20/);
  });

  it("prints no block for a target no case ran on", () => {
    const pluginEval = finishedEval();
    pluginEval.spec!.targets.push(create(PluginEvalTargetSchema, { harness: Harness.CURSOR, modelName: "gpt-5" }));
    const out = renderEvalTables(pluginEval);
    expect(out.split("\n")[0]).toBe("native/claude-sonnet-4-6");
    expect(out).not.toContain("cursor/gpt-5");
  });

  it("keeps a run's error on one line in NOTES", () => {
    const pluginEval = finishedEval();
    pluginEval.status!.cases[0]!.targets[0]!.withPlugin!.tries[0]!.error = "model said\n\u001b[31mno";
    expect(renderEvalTables(pluginEval)).toContain("model said [31mno");
  });
});

describe("renderSummaryLine", () => {
  it("is the format's line, marked provisional when the eval says so", () => {
    expect(renderSummaryLine(finishedEval(), 74)).toBe("1 case(s) · mean Δ +0.67 · 74s · $0.41 · Δ provisional");
  });

  it("drops the mean Δ, and the mark, when no case had a comparison", () => {
    const pluginEval = finishedEval();
    pluginEval.status!.aggregates!.meanDelta = undefined;
    expect(renderSummaryLine(pluginEval, 10)).toBe("1 case(s) · 10s · $0.41");
  });
});

describe("renderNotRun", () => {
  it("names each case not run with the feature, and a case not run on one target", () => {
    const pluginEval = finishedEval();
    pluginEval.status!.cases[0]!.targets[0]!.notRunReason = "not run: model 'sonnet' is not in Stigmer's catalog";
    expect(renderNotRun(pluginEval)).toBe(
      "Not run:\n" +
        "  first-case on native/claude-sonnet-4-6: not run: model 'sonnet' is not in Stigmer's catalog\n" +
        "  needs-fixture: not run: context.scaffold_script\n",
    );
  });
});

describe("partialLine", () => {
  it("says why an eval stopped, and nothing for one that finished", () => {
    const pluginEval = finishedEval(PluginEvalPhase.partial);
    expect(partialLine(finishedEval(), false)).toBe("");
    pluginEval.status!.partialReason = PluginEvalPartialReason.cost_ceiling;
    expect(partialLine(pluginEval, false)).toBe("Stopped at the spending limit: 3 of 4 tries ran.");
    pluginEval.status!.partialReason = PluginEvalPartialReason.out_of_credit;
    expect(partialLine(pluginEval, false)).toContain("out of credit");
    pluginEval.status!.partialReason = PluginEvalPartialReason.cancelled;
    expect(partialLine(pluginEval, false)).toBe("Cancelled: 3 of 4 tries ran.");
    expect(partialLine(finishedEval(PluginEvalPhase.running), true)).toBe("Cancelled: 3 of 4 tries ran.");
  });

  it("reads a reason a newer server added as stopped early, never as a bare number", () => {
    const pluginEval = finishedEval(PluginEvalPhase.partial);
    pluginEval.status!.partialReason = 99 as PluginEvalPartialReason;
    expect(partialLine(pluginEval, false)).toBe("Stopped early (reason 99): 3 of 4 tries ran.");
  });
});

describe("evalExitCode", () => {
  const exit = (pluginEval = finishedEval(), interrupted = false, loadFindings = 0) =>
    evalExitCode(pluginEval, { interrupted, loadFindings });

  it("is 0 when every case that ran passed and loaded, whatever was not run", () => {
    expect(exit()).toBe(EvalExit.Passed);
  });

  it("is 1 for a case below the threshold, a load finding, no case, or a failed eval", () => {
    const below = finishedEval();
    below.status!.aggregates!.casesPassed = 0;
    expect(exit(below)).toBe(EvalExit.Failed);
    expect(exit(finishedEval(), false, 1)).toBe(EvalExit.Failed);
    const empty = finishedEval();
    empty.status!.aggregates!.casesTotal = 0;
    empty.status!.aggregates!.casesPassed = 0;
    expect(exit(empty)).toBe(EvalExit.Failed);
    expect(exit(finishedEval(PluginEvalPhase.failed))).toBe(EvalExit.Failed);
  });

  it("is 2 for a partial run, at the spending limit or out of credit", () => {
    for (const reason of [PluginEvalPartialReason.cost_ceiling, PluginEvalPartialReason.out_of_credit]) {
      const partial = finishedEval(PluginEvalPhase.partial);
      partial.status!.partialReason = reason;
      expect(exit(partial)).toBe(EvalExit.Partial);
    }
  });

  it("is 130 when this command was interrupted or someone cancelled the eval", () => {
    expect(exit(finishedEval(PluginEvalPhase.running), true)).toBe(EvalExit.Interrupted);
    const cancelled = finishedEval(PluginEvalPhase.partial);
    cancelled.status!.partialReason = PluginEvalPartialReason.cancelled;
    expect(exit(cancelled)).toBe(EvalExit.Interrupted);
  });
});

describe("isSettled", () => {
  it("settles on completed, partial and failed only", () => {
    expect([PluginEvalPhase.completed, PluginEvalPhase.partial, PluginEvalPhase.failed].map((phase) => isSettled(finishedEval(phase)))).toEqual([true, true, true]);
    expect([PluginEvalPhase.pending, PluginEvalPhase.running].map((phase) => isSettled(finishedEval(phase)))).toEqual([false, false]);
  });

  it("stops following at a phase a newer server added, rather than polling forever", () => {
    expect(isSettled(finishedEval(99 as PluginEvalPhase))).toBe(true);
  });
});
