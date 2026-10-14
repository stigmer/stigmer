// Pins what `eval run` prints about an agent and its exit code: a progress
// line per finished try named `<plugin>/<case>`, keyed apart when two
// plugins have a case of one name; the one-arm table when nothing is
// compared, one block per plugin and target, headed by the agent's slug
// and short version hash, the plugin's slug and short digest, and the
// target; the two-arm table, the compared plugin marked, when one is; a
// plugin not run as its heading and reason; the cases a plugin did not run
// under `Not run:`; the summary with no mean Δ; and the exit code over
// every plugin's cases (0, 1 for a case below the threshold or none run,
// 130 when cancelled).

import { EvalRunAblation } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPartialReason, EvalRunPhase, EvalRunTryState } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { describe, expect, it } from "vitest";
import { EvalExit, evalExitCode, finishedTries, renderEvalReport, renderEvalTables, renderNotRun } from "../report.js";
import { finishedEvalRunOnAgent } from "./fixtures.js";

describe("finishedTries about an agent", () => {
  it("names each try's case by its plugin, and keys two plugins' same-named cases apart", () => {
    const tries = finishedTries(finishedEvalRunOnAgent());
    expect(tries.map((attempt) => attempt.line)).toEqual([
      "refund-policy/refund-window · native/claude-sonnet-4-6 · with · try 1/1 · 1.00",
      "tracker/refund-window · native/claude-sonnet-4-6 · with · try 1/1 · 1.00",
    ]);
    expect(new Set(tries.map((attempt) => attempt.key)).size).toBe(2);
  });
});

describe("renderEvalTables about an agent", () => {
  it("prints a one-arm block per plugin and target under the agent's and plugin's versions, and a plugin not run with its reason", () => {
    const lines = renderEvalTables(finishedEvalRunOnAgent(), "support-desk").split("\n");
    expect(lines[0]).toBe("support-desk@0123456789ab · refund-policy@c0ffee111111 · native/claude-sonnet-4-6");
    expect(lines[1]).toMatch(/^CASE\s+SCORE\s+PASS%\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[3]).toMatch(/^refund-window\s+1\.00\s+100%\s+yes\s+1\s+\$0\.20$/);
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("support-desk@0123456789ab · tracker@beef00222222 · native/claude-sonnet-4-6");
    expect(lines[8]).toMatch(/^refund-window\s+1\.00\s+100%\s+yes\s+1\s+\$0\.30$/);
    expect(lines.slice(9)).toEqual(["", "support-desk@0123456789ab · notes@abcdef333333", "  not run: not selected", ""]);
    expect(lines.join("\n")).not.toContain("needs-fixture");
  });

  it("heads with the requested version before the eval run stamps one, and the slug alone with none", () => {
    const evalRun = finishedEvalRunOnAgent();
    evalRun.status!.agentVersionHash = "";
    evalRun.spec!.agentVersion = "stable";
    expect(renderEvalTables(evalRun, "support-desk").split("\n")[0]).toMatch(/^support-desk@stable · /);
    evalRun.spec!.agentVersion = "";
    expect(renderEvalTables(evalRun, "support-desk").split("\n")[0]).toMatch(/^support-desk · refund-policy@/);
  });

  it("keeps a plugin's reason and slug on one line", () => {
    const evalRun = finishedEvalRunOnAgent();
    evalRun.status!.plugins[2]!.notRunReason = "no eval cases\n\u001b[2Jat this version";
    expect(renderEvalTables(evalRun, "support-desk")).toContain("  not run: no eval cases [2Jat this version");
  });
});

describe("renderEvalTables comparing a plugin on an agent", () => {
  it("prints the two-arm table, the compared plugin marked", () => {
    const evalRun = finishedEvalRunOnAgent();
    evalRun.spec!.comparedPluginId = "plg_refund";
    evalRun.spec!.ablation = EvalRunAblation.with_without;
    evalRun.status!.plugins[0]!.compared = true;
    const lines = renderEvalTables(evalRun, "support-desk").split("\n");
    expect(lines[0]).toBe("support-desk@0123456789ab · refund-policy@c0ffee111111 (compared) · native/claude-sonnet-4-6");
    expect(lines[1]).toMatch(/^CASE\s+WITH\s+W\/OUT\s+Δ\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[5]).toBe("support-desk@0123456789ab · tracker@beef00222222 · native/claude-sonnet-4-6");
  });

  it("prints the one-arm table when the comparison's ablation is none", () => {
    const evalRun = finishedEvalRunOnAgent();
    evalRun.spec!.comparedPluginId = "plg_refund";
    evalRun.spec!.ablation = EvalRunAblation.none;
    expect(renderEvalTables(evalRun, "support-desk").split("\n")[1]).toMatch(/^CASE\s+SCORE\s+PASS%/);
  });
});

describe("renderNotRun about an agent", () => {
  it("names each case a plugin listed and did not run, by its plugin", () => {
    expect(renderNotRun(finishedEvalRunOnAgent())).toBe("Not run:\n  tracker/needs-fixture: not run: plugins\n");
  });
});

describe("renderEvalReport about an agent", () => {
  it("prints the tables, the summary with no mean Δ, and the cases not run", () => {
    const out = renderEvalReport(finishedEvalRunOnAgent(), {
      subjectSlug: "support-desk",
      interrupted: false,
      durationSeconds: 42,
      stillRunning: "",
    });
    expect(out).toContain("support-desk@0123456789ab · refund-policy@c0ffee111111");
    expect(out).toContain("\n2 case(s) · 42s · $0.50\n");
    expect(out).not.toContain("Δ");
    expect(out.endsWith("Not run:\n  tracker/needs-fixture: not run: plugins\n")).toBe(true);
  });

  it("says why the eval run stopped, or that it may still be running", () => {
    const evalRun = finishedEvalRunOnAgent(EvalRunPhase.partial);
    evalRun.status!.partialReason = EvalRunPartialReason.cost_ceiling;
    const opts = { subjectSlug: "support-desk", interrupted: false, durationSeconds: 1, stillRunning: "" };
    expect(renderEvalReport(evalRun, opts)).toContain("Stopped at the spending limit: 2 of 2 tries ran.");
    expect(renderEvalReport(evalRun, { ...opts, stillRunning: "Lost track of the eval run; it may still be running" })).toContain(
      "Lost track of the eval run; it may still be running",
    );
  });
});

describe("evalExitCode about an agent", () => {
  it("is 0 when every case that ran on every plugin passed", () => {
    expect(evalExitCode(finishedEvalRunOnAgent(), { interrupted: false, loadFindings: 0 })).toBe(EvalExit.Passed);
  });

  it("is 1 when a case on any plugin is below the threshold", () => {
    const evalRun = finishedEvalRunOnAgent();
    evalRun.status!.aggregates!.casesPassed = 1;
    expect(evalExitCode(evalRun, { interrupted: false, loadFindings: 0 })).toBe(EvalExit.Failed);
  });

  it("is 1 when no case ran", () => {
    const evalRun = finishedEvalRunOnAgent();
    evalRun.status!.aggregates!.casesTotal = 0;
    evalRun.status!.aggregates!.casesPassed = 0;
    expect(evalExitCode(evalRun, { interrupted: false, loadFindings: 0 })).toBe(EvalExit.Failed);
  });

  it("is 1 when a plugin's case was never graded on its target", () => {
    const evalRun = finishedEvalRunOnAgent();
    const attempt = evalRun.status!.plugins[1]!.cases[0]!.targets[0]!.withPlugin!.tries[0]!;
    attempt.state = EvalRunTryState.not_graded;
    expect(evalExitCode(evalRun, { interrupted: false, loadFindings: 0 })).toBe(EvalExit.Failed);
  });

  it("is 2 for a partial eval run and 130 when cancelled", () => {
    const partial = finishedEvalRunOnAgent(EvalRunPhase.partial);
    partial.status!.partialReason = EvalRunPartialReason.cost_ceiling;
    expect(evalExitCode(partial, { interrupted: false, loadFindings: 0 })).toBe(EvalExit.Partial);
    expect(evalExitCode(finishedEvalRunOnAgent(), { interrupted: true, loadFindings: 0 })).toBe(EvalExit.Interrupted);
  });
});
