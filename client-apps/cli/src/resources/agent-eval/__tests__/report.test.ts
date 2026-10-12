// Pins what `agent eval` prints and its exit code: a progress line per
// finished try named `<plugin>/<case>`, keyed apart when two plugins have a
// case of one name; the one-arm table, one block per plugin and target,
// headed by the agent's slug and short version hash, the plugin's slug and
// short digest, and the target; a plugin not run as its heading and
// reason; the cases a plugin did not run under `Not run:`; the summary
// with no mean Δ; and the exit code over every plugin's cases (0, 1 for a
// case below the threshold or none run, 130 when cancelled).

import { PluginEvalPartialReason, PluginEvalPhase, PluginEvalTryState } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { describe, expect, it } from "vitest";
import { EvalExit } from "../../plugin-eval/report.js";
import {
  agentEvalExitCode,
  agentFinishedTries,
  renderAgentEvalReport,
  renderAgentEvalTables,
  renderAgentNotRun,
} from "../report.js";
import { finishedAgentEval } from "./fixtures.js";

describe("agentFinishedTries", () => {
  it("names each try's case by its plugin, and keys two plugins' same-named cases apart", () => {
    const tries = agentFinishedTries(finishedAgentEval());
    expect(tries.map((attempt) => attempt.line)).toEqual([
      "refund-policy/refund-window · native/claude-sonnet-4-6 · with · try 1/1 · 1.00",
      "tracker/refund-window · native/claude-sonnet-4-6 · with · try 1/1 · 1.00",
    ]);
    expect(new Set(tries.map((attempt) => attempt.key)).size).toBe(2);
  });
});

describe("renderAgentEvalTables", () => {
  it("prints a one-arm block per plugin and target under the agent's and plugin's versions, and a plugin not run with its reason", () => {
    const lines = renderAgentEvalTables(finishedAgentEval(), "support-desk").split("\n");
    expect(lines[0]).toBe("support-desk@0123456789ab · refund-policy@c0ffee111111 · native/claude-sonnet-4-6");
    expect(lines[1]).toMatch(/^CASE\s+SCORE\s+PASS%\s+PASS\^k\s+RUNS\s+COST\s+NOTES$/);
    expect(lines[3]).toMatch(/^refund-window\s+1\.00\s+100%\s+yes\s+1\s+\$0\.20$/);
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("support-desk@0123456789ab · tracker@beef00222222 · native/claude-sonnet-4-6");
    expect(lines[8]).toMatch(/^refund-window\s+1\.00\s+100%\s+yes\s+1\s+\$0\.30$/);
    expect(lines.slice(9)).toEqual(["", "support-desk@0123456789ab · notes@abcdef333333", "  not run: not selected", ""]);
    expect(lines.join("\n")).not.toContain("needs-fixture");
  });

  it("heads with the requested version before the eval stamps one, and the slug alone with none", () => {
    const agentEval = finishedAgentEval();
    agentEval.status!.agentVersionHash = "";
    agentEval.spec!.agentVersion = "stable";
    expect(renderAgentEvalTables(agentEval, "support-desk").split("\n")[0]).toMatch(/^support-desk@stable · /);
    agentEval.spec!.agentVersion = "";
    expect(renderAgentEvalTables(agentEval, "support-desk").split("\n")[0]).toMatch(/^support-desk · refund-policy@/);
  });

  it("keeps a plugin's reason and slug on one line", () => {
    const agentEval = finishedAgentEval();
    agentEval.status!.plugins[2]!.notRunReason = "no eval cases\n\u001b[2Jat this version";
    expect(renderAgentEvalTables(agentEval, "support-desk")).toContain("  not run: no eval cases [2Jat this version");
  });
});

describe("renderAgentNotRun", () => {
  it("names each case a plugin listed and did not run, by its plugin", () => {
    expect(renderAgentNotRun(finishedAgentEval())).toBe("Not run:\n  tracker/needs-fixture: not run: plugins\n");
  });
});

describe("renderAgentEvalReport", () => {
  it("prints the tables, the summary with no mean Δ, and the cases not run", () => {
    const out = renderAgentEvalReport(finishedAgentEval(), {
      agentSlug: "support-desk",
      interrupted: false,
      durationSeconds: 42,
      stillRunning: "",
    });
    expect(out).toContain("support-desk@0123456789ab · refund-policy@c0ffee111111");
    expect(out).toContain("\n2 case(s) · 42s · $0.50\n");
    expect(out).not.toContain("Δ");
    expect(out.endsWith("Not run:\n  tracker/needs-fixture: not run: plugins\n")).toBe(true);
  });

  it("says why the eval stopped, or that it may still be running", () => {
    const agentEval = finishedAgentEval(PluginEvalPhase.partial);
    agentEval.status!.partialReason = PluginEvalPartialReason.cost_ceiling;
    const opts = { agentSlug: "support-desk", interrupted: false, durationSeconds: 1, stillRunning: "" };
    expect(renderAgentEvalReport(agentEval, opts)).toContain("Stopped at the spending limit: 2 of 2 tries ran.");
    expect(renderAgentEvalReport(agentEval, { ...opts, stillRunning: "Lost track of the eval; it may still be running" })).toContain(
      "Lost track of the eval; it may still be running",
    );
  });
});

describe("agentEvalExitCode", () => {
  it("is 0 when every case that ran on every plugin passed", () => {
    expect(agentEvalExitCode(finishedAgentEval(), { interrupted: false })).toBe(EvalExit.Passed);
  });

  it("is 1 when a case on any plugin is below the threshold", () => {
    const agentEval = finishedAgentEval();
    agentEval.status!.aggregates!.casesPassed = 1;
    expect(agentEvalExitCode(agentEval, { interrupted: false })).toBe(EvalExit.Failed);
  });

  it("is 1 when no case ran", () => {
    const agentEval = finishedAgentEval();
    agentEval.status!.aggregates!.casesTotal = 0;
    agentEval.status!.aggregates!.casesPassed = 0;
    expect(agentEvalExitCode(agentEval, { interrupted: false })).toBe(EvalExit.Failed);
  });

  it("is 1 when a plugin's case was never graded on its target", () => {
    const agentEval = finishedAgentEval();
    const attempt = agentEval.status!.plugins[1]!.cases[0]!.targets[0]!.withPlugin!.tries[0]!;
    attempt.state = PluginEvalTryState.not_graded;
    expect(agentEvalExitCode(agentEval, { interrupted: false })).toBe(EvalExit.Failed);
  });

  it("is 2 for a partial eval and 130 when cancelled", () => {
    const partial = finishedAgentEval(PluginEvalPhase.partial);
    partial.status!.partialReason = PluginEvalPartialReason.cost_ceiling;
    expect(agentEvalExitCode(partial, { interrupted: false })).toBe(EvalExit.Partial);
    expect(agentEvalExitCode(finishedAgentEval(), { interrupted: true })).toBe(EvalExit.Interrupted);
  });
});
