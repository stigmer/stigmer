// Pins what `eval run` prints about a plugin and its exit code: a progress
// line per finished try (case, target, arm, try, score or not-graded
// reason, and the run's error or the mock that stopped it), and a case's
// mocked: line once, before its first finished try; the format's table,
// one block per target under the plugin's slug and short digest, with
// Stigmer's PASS^k column (no block for a target nothing ran on), and
// SCORE PASS% when the eval run made no comparison; the summary line; the
// not-run cases with the feature named; a target's model name, which a
// suite writes, kept on one line everywhere it is printed; why a partial
// eval run stopped; and the exit codes 0, 1, 2 and 130, a case whose
// with-plugin tries were all not graded never a 0. report-agent.test.ts
// pins the views of an eval run about an agent.

import { create } from "@bufbuild/protobuf";
import { EvalRunAblation, EvalRunTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunAbortSchema,
  EvalRunCaseTargetSchema,
  EvalRunMockedServerSchema,
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
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
import { casesOf, finishedEval } from "./fixtures.js";

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

describe("a case's mocks", () => {
  it("prints the mocked: line once before the case's first finished try, and an abort on its try and in NOTES", () => {
    const evalRun = finishedEval();
    const evalCase = casesOf(evalRun)[0]!;
    evalCase.mockedServers = [
      create(EvalRunMockedServerSchema, { name: "plugin_kit_tracker", tools: ["create_issue", "close_issue"] }),
      create(EvalRunMockedServerSchema, { name: "plugin_kit_wiki", notStartedReason: "not started: no mock" }),
    ];
    const first = evalCase.targets[0]!.withPlugin!.tries[0]!;
    first.score = 0;
    first.aborted = create(EvalRunAbortSchema, { server: "tracker", tool: "create_issue", reason: "input.title must be a string" });
    const lines = finishedTries(evalRun).map((attempt) => attempt.line);
    expect(lines.slice(0, 2)).toEqual([
      "first-case · mocked: plugin_kit_tracker(create_issue, close_issue), plugin_kit_wiki[not started: no mock]",
      "first-case · native/claude-sonnet-4-6 · with · try 1/2 · 0.00 (aborted by tracker.create_issue: input.title must be a string)",
    ]);
    expect(lines.filter((line) => line.includes("mocked:"))).toHaveLength(1);
    expect(renderEvalTables(evalRun, "")).toContain("aborted by tracker.create_issue");
  });
});

describe("renderEvalTables", () => {
  it("prints the format's columns with PASS^k under a heading for the target, leaving out cases not run", () => {
    const out = renderEvalTables(finishedEval(), "");
    const lines = out.split("\n");
    expect(lines[0]).toBe("thermos@d10000000000 · native/claude-sonnet-4-6");
    expect(lines[1]).toMatch(/^CASE\s+WITH\s+W\/OUT\s+Δ\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[3]).toMatch(/^first-case\s+1\.00\s+0\.33\s+\+0\.67\s+yes\s+4\s+\$0\.41\s+not graded: platform busy$/);
    expect(out).not.toContain("needs-fixture");
  });

  it("shows SCORE and PASS% when the eval run made no comparison", () => {
    const evalRun = finishedEval();
    evalRun.spec!.ablation = EvalRunAblation.none;
    const target = casesOf(evalRun)[0]!.targets[0]!;
    target.withoutPlugin = undefined;
    target.delta = undefined;
    const lines = renderEvalTables(evalRun, "").split("\n");
    expect(lines[1]).toMatch(/^CASE\s+SCORE\s+PASS%\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[3]).toMatch(/^first-case\s+1\.00\s+100%\s+yes\s+2\s+\$0\.20/);
  });

  it("prints no block for a target no case ran on", () => {
    const evalRun = finishedEval();
    evalRun.spec!.targets.push(create(EvalRunTargetSchema, { harness: Harness.CURSOR, modelName: "gpt-5" }));
    const out = renderEvalTables(evalRun, "");
    expect(out.split("\n")[0]).toBe("thermos@d10000000000 · native/claude-sonnet-4-6");
    expect(out).not.toContain("cursor/gpt-5");
  });

  it("keeps a run's error on one line in NOTES", () => {
    const evalRun = finishedEval();
    casesOf(evalRun)[0]!.targets[0]!.withPlugin!.tries[0]!.error = "model said\n\u001b[31mno";
    expect(renderEvalTables(evalRun, "")).toContain("model said [31mno");
  });
});

describe("renderSummaryLine", () => {
  it("is the format's line", () => {
    expect(renderSummaryLine(finishedEval(), 74)).toBe("1 case(s) · mean Δ +0.67 · 74s · $0.41");
  });

  it("drops the mean Δ when no case had a comparison", () => {
    const evalRun = finishedEval();
    evalRun.status!.aggregates!.meanDelta = undefined;
    expect(renderSummaryLine(evalRun, 10)).toBe("1 case(s) · 10s · $0.41");
  });
});

describe("renderNotRun", () => {
  it("names each case not run with the feature, and a case not run on one target", () => {
    const evalRun = finishedEval();
    casesOf(evalRun)[0]!.targets[0]!.notRunReason = "not run: model 'sonnet' is not in Stigmer's catalog";
    expect(renderNotRun(evalRun)).toBe(
      "Not run:\n" +
        "  first-case on native/claude-sonnet-4-6: not run: model 'sonnet' is not in Stigmer's catalog\n" +
        "  needs-fixture: not run: plugins\n",
    );
  });
});

describe("a target's model name", () => {
  it("never writes an escape sequence or a newline to the terminal, wherever the label is printed", () => {
    const evalRun = finishedEval();
    const hostile = { harness: Harness.NATIVE, modelName: "evil\u001b]0;owned\u0007\n\u001b[2J" };
    evalRun.spec!.targets[0] = create(EvalRunTargetSchema, hostile);
    const target = casesOf(evalRun)[0]!.targets[0]!;
    target.target = create(EvalRunTargetSchema, hostile);
    casesOf(evalRun).push({ ...casesOf(evalRun)[0]!, caseName: "second", notRunReason: "" });
    casesOf(evalRun)[2]!.targets = [{ ...target, notRunReason: "not run: unknown model" }];
    const printed = [
      renderNotRun(evalRun),
      renderEvalTables(evalRun, ""),
      ...finishedTries(evalRun).map((attempt) => attempt.line),
    ].join("\n");
    expect(printed).toContain("second on native/evil ]0;owned [2J: not run: unknown model");
    expect(printed).toContain("first-case · native/evil ]0;owned [2J · with · try 1/2 · 1.00");
    expect(printed.split("\n")).toContain("thermos@d10000000000 · native/evil ]0;owned [2J");
    expect(printed).not.toMatch(/[\u001b\u0007]/);
  });
});

describe("partialLine", () => {
  it("says why an eval stopped, and nothing for one that finished", () => {
    const evalRun = finishedEval(EvalRunPhase.partial);
    expect(partialLine(finishedEval(), false)).toBe("");
    evalRun.status!.partialReason = EvalRunPartialReason.cost_ceiling;
    expect(partialLine(evalRun, false)).toBe("Stopped at the spending limit: 3 of 4 tries ran.");
    evalRun.status!.partialReason = EvalRunPartialReason.cancelled;
    expect(partialLine(evalRun, false)).toBe("Cancelled: 3 of 4 tries ran.");
    expect(partialLine(finishedEval(EvalRunPhase.running), true)).toBe("Cancelled: 3 of 4 tries ran.");
  });

  it("reads a reason a newer server added as stopped early, never as a bare number", () => {
    const evalRun = finishedEval(EvalRunPhase.partial);
    evalRun.status!.partialReason = 99 as EvalRunPartialReason;
    expect(partialLine(evalRun, false)).toBe("Stopped early (reason 99): 3 of 4 tries ran.");
  });
});

describe("evalExitCode", () => {
  const exit = (evalRun = finishedEval(), interrupted = false, loadFindings = 0) =>
    evalExitCode(evalRun, { interrupted, loadFindings });

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
    expect(exit(finishedEval(EvalRunPhase.failed))).toBe(EvalExit.Failed);
  });

  it("is 1, never 0, for a case whose with-plugin tries on a target were all not graded", () => {
    // The server leaves such a case out of its counts, so every other case
    // passing would read as a pass.
    const unrun = finishedEval();
    const tries = casesOf(unrun)[0]!.targets[0]!.withPlugin!.tries;
    tries[0]!.state = EvalRunTryState.not_graded;
    tries[0]!.notGradedReason = "platform busy";
    expect(exit(unrun)).toBe(EvalExit.Failed);
    // A target not run, and a case not run, are named, never failed.
    const notRun = finishedEval();
    casesOf(notRun)[0]!.targets.push(
      create(EvalRunCaseTargetSchema, {
        notRunReason: "not run: unknown model",
        withPlugin: { tries: [{ index: 1, state: EvalRunTryState.pending }] },
      }),
    );
    expect(exit(notRun)).toBe(EvalExit.Passed);
  });

  it("is 2 for a partial run at the spending limit", () => {
    const partial = finishedEval(EvalRunPhase.partial);
    partial.status!.partialReason = EvalRunPartialReason.cost_ceiling;
    expect(exit(partial)).toBe(EvalExit.Partial);
  });

  it("is 2 for a partial eval whose reason, or phase, a newer server added, whatever its cases scored", () => {
    const unknownReason = finishedEval(EvalRunPhase.partial);
    unknownReason.status!.partialReason = 9 as EvalRunPartialReason;
    expect(exit(unknownReason)).toBe(EvalExit.Partial);
    const noReason = finishedEval(EvalRunPhase.partial);
    expect(exit(noReason)).toBe(EvalExit.Partial);
    expect(exit(finishedEval(9 as EvalRunPhase))).toBe(EvalExit.Partial);
  });

  it("is 130 when this command was interrupted or someone cancelled the eval", () => {
    expect(exit(finishedEval(EvalRunPhase.running), true)).toBe(EvalExit.Interrupted);
    const cancelled = finishedEval(EvalRunPhase.partial);
    cancelled.status!.partialReason = EvalRunPartialReason.cancelled;
    expect(exit(cancelled)).toBe(EvalExit.Interrupted);
  });
});

describe("isSettled", () => {
  it("settles on completed, partial and failed only", () => {
    expect([EvalRunPhase.completed, EvalRunPhase.partial, EvalRunPhase.failed].map((phase) => isSettled(finishedEval(phase)))).toEqual([true, true, true]);
    expect([EvalRunPhase.pending, EvalRunPhase.running].map((phase) => isSettled(finishedEval(phase)))).toEqual([false, false]);
  });

  it("stops following at a phase a newer server added, rather than polling forever", () => {
    expect(isSettled(finishedEval(99 as EvalRunPhase))).toBe(true);
  });
});
